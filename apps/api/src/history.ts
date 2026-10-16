// The history of edits (the `changes` table of the state database): read a
// filtered page of it, or undo one change. An undo writes the change's
// previous state only while the file still holds what the change wrote,
// compared by fingerprint; a secret's change is never undone, as its value
// is never stored.

import {
  type ChangeFilter,
  type ChangeRecord,
  type UndoFailure,
  queryChanges,
  undoBlocker,
  undoChange,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  historyChange,
  historyQuery,
  historyResponse,
  undoResponse,
} from './contracts.ts';
import { ApiError } from './http.ts';
import { fileInfoOf } from './inspect.ts';
import { type Project, readSchema } from './project.ts';
import { currentSchema } from './schema.ts';
import { editContext } from './values.ts';

type Change = z.output<typeof historyChange>;

/** A recorded change as the API shows it: never a fingerprint. */
export function changeView(change: ChangeRecord): Change {
  const blocker = undoBlocker(change);
  return {
    id: change.id,
    actor: change.actor,
    file: change.file,
    key: change.key,
    operation: change.operation,
    at: change.at,
    secret: change.notKept === 'secret',
    beforePreview: change.beforePreview,
    afterPreview: change.afterPreview,
    beforeValue: change.beforeValue,
    afterValue: change.afterValue,
    restorable: change.restorable,
    ...(blocker ? { undoBlocker: blocker } : {}),
    undoOf: change.undoOf,
  };
}

/** The state database's errors answer 503: the history cannot be read. */
async function stateCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, (error as Error).message);
  }
}

/** GET /api/history: a page of changes, newest first. */
export async function readHistory(
  project: Project,
  query: z.output<typeof historyQuery>,
): Promise<z.output<typeof historyResponse>> {
  const filter: ChangeFilter = query;
  const page = await stateCall(() => queryChanges(project.statePath, filter));
  return { ...page, changes: page.changes.map(changeView) };
}

/** The current state of what `change` touched: its file, or the schema. */
async function currentOf(project: Project, change: ChangeRecord) {
  if (change.operation === 'schema')
    return { schema: await currentSchema(project) };
  const { schema } = await readSchema(project);
  if (!schema?.files.some((file) => file.path === change.file)) return {};
  return { file: await fileInfoOf(schema, project.root, change.file) };
}

/** An undo that wrote nothing, as the error it answers with. */
async function refusal(
  project: Project,
  result: UndoFailure,
): Promise<ApiError> {
  const change = result.change && changeView(result.change);
  switch (result.kind) {
    case 'not-found':
      return new ApiError(404, result.message);
    case 'not-restorable':
      return new ApiError(422, result.message, {
        kind: 'not-restorable',
        errors: [{ message: result.message }],
        change,
      });
    case 'mismatch':
      return new ApiError(409, result.message, {
        change,
        ...(await currentOf(project, result.change!)),
      });
    case 'invalid':
      return new ApiError(422, 'nothing was undone', {
        kind: 'invalid',
        errors: result.messages.map((message) => ({ message })),
        change,
      });
    case 'protected':
      return new ApiError(422, 'nothing was undone', {
        kind: 'protected',
        errors: result.problems.map(({ key, message, reason }) => ({
          key,
          message,
          ...(reason ? { reason } : {}),
        })),
        change,
      });
    case 'state':
      return new ApiError(503, result.lines.join('; '));
    case 'cancelled':
      return new ApiError(500, 'the undo was cancelled');
    case 'write':
      return new ApiError(500, result.message);
  }
}

/** POST /api/history/{id}/undo. */
export async function undoHistoryChange(
  project: Project,
  id: number,
): Promise<z.output<typeof undoResponse>> {
  const { schema } = await readSchema(project);
  const result = await stateCall(async () =>
    undoChange(
      {
        statePath: project.statePath,
        actor: 'portal',
        root: project.root,
        schemaPath: project.schemaPath,
        schemaFile: project.schemaFile,
        edit: schema && (await editContext(schema, project)),
      },
      id,
    ),
  );
  if (!result.ok) throw await refusal(project, result);
  return {
    undone: changeView(result.undone),
    ...(result.change ? { change: changeView(result.change) } : {}),
    ...(await currentOf(project, result.undone)),
    warnings: [...(result.stateError ?? []), ...result.warnings],
  };
}
