// The value writes: set (or generate) and unset keys of one schema file
// through the core's per-key edits, so the portal never edits a file on its
// own. Each write names the fingerprint of the file it was based on, keeps
// every protected value unless asked to replace it by key, and is recorded
// in the history of edits: a secret's value never, any other's so the edit
// can be undone. The answer names the changes recorded.

import { readFile } from 'node:fs/promises';
import {
  type EditContext,
  type EditFailure,
  type EnvFile,
  type ChangeActor,
  type EnvSchema,
  type ProtectedProblem,
  generatableProblem,
  generateValue,
  getValue,
  maskValue,
  readEnvFile,
  recordHistory,
  serialize,
  setChanges,
  setValues,
  unsetChanges,
  unsetValues,
  variablesOf,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  editProblem,
  setValuesRequest,
  unsetValuesRequest,
  valuesResponse,
} from './contracts.ts';
import { contentFingerprint } from './fingerprint.ts';
import { ApiError } from './http.ts';
import { fileInfoOf } from './inspect.ts';
import type { Project } from './project.ts';
import { protectedState } from './state.ts';

type ValuesEdit = z.output<typeof valuesResponse>;
type EditProblem = z.output<typeof editProblem>;

/** A 422: the edit wrote nothing, for `kind`'s reasons. */
const refused = (kind: 'invalid' | 'protected', errors: EditProblem[]) =>
  new ApiError(422, 'nothing was written', { kind, errors });

/** A 409 with the file as it is now. */
async function stale(schema: EnvSchema, project: Project, path: string) {
  return new ApiError(
    409,
    `${path} changed since it was read; reload it and make the edit again`,
    { file: await fileInfoOf(schema, project.root, path) },
  );
}

/** The file to edit, as it is on disk, when it is still what the edit saw. */
async function openFile(
  schema: EnvSchema,
  project: Project,
  path: string,
  fingerprint: string | null,
): Promise<EnvFile> {
  const spec = schema.files.find((file) => file.path === path);
  if (!spec) throw new ApiError(404, `${path} is not a schema file`);
  const read = await readEnvFile(project.root, spec);
  if (!read.ok) throw new ApiError(403, read.message);
  if (contentFingerprint(read.file.previous) !== fingerprint)
    throw await stale(schema, project, path);
  return read.file;
}

export async function editContext(
  schema: EnvSchema,
  project: Project,
): Promise<EditContext> {
  const state = await protectedState(schema, project);
  return {
    schema,
    run: state && { path: project.statePath, state },
    cwd: project.cwd ?? project.root,
    ...(project.writeState ? { writeState: project.writeState } : {}),
  };
}

const protectedProblems = (problems: readonly ProtectedProblem[]) =>
  problems.map(({ key, message, reason }) => ({
    key,
    message,
    ...(reason ? { reason } : {}),
  }));

/** An edit that wrote nothing, as the error it answers with. */
async function failure(
  schema: EnvSchema,
  project: Project,
  file: EnvFile,
  result: EditFailure,
): Promise<ApiError> {
  switch (result.kind) {
    case 'invalid':
      return refused(
        'invalid',
        result.messages.map((message) => ({ message })),
      );
    case 'protected':
      return refused('protected', protectedProblems(result.problems));
    case 'cancelled':
      return new ApiError(500, 'the edit was cancelled');
    case 'state':
      return new ApiError(503, result.lines.join('; '), {
        path: result.path,
        lines: result.lines,
      });
    case 'write': {
      // The core refuses to write over a file that changed since it read it.
      const now = await readFile(file.absolute, 'utf8').catch(() => undefined);
      if (now !== file.previous) return stale(schema, project, file.spec.path);
      return new ApiError(500, result.message);
    }
  }
}

/**
 * The edit options of a write: its replacements and, when it asks to
 * confirm them, the confirmation that refuses them, noting the keys.
 */
function replacing(body: {
  replaceProtected?: string[] | undefined;
  confirmReplacements?: boolean | undefined;
}) {
  const asked: string[] = [];
  return {
    asked,
    options: {
      replace: new Set(body.replaceProtected ?? []),
      ...(body.confirmReplacements
        ? {
            confirm: async (keys: string[]) => {
              asked.push(...keys);
              return false;
            },
          }
        : {}),
    },
  };
}

/** A 428: the replacements to confirm before the edit is sent again. */
const toConfirm = (keys: readonly string[]) =>
  new ApiError(428, 'confirm the protected values to replace', {
    keys: [...keys],
  });

/** The fingerprint of the file after an edit that may have written it. */
const fingerprintAfter = (file: EnvFile, written: boolean) =>
  contentFingerprint(written ? serialize(file.doc) : file.previous);

/** The history's actor of a request: its X-Configure-Env-Client header's. */
export const actorOf = (client: string | undefined): ChangeActor =>
  client === 'cli' ? 'cli' : 'portal';

/** Sets values (given or generated) in one file: POST /api/values/set. */
export async function setFileValues(
  schema: EnvSchema,
  project: Project,
  body: z.output<typeof setValuesRequest>,
  actor: ChangeActor = 'portal',
): Promise<ValuesEdit> {
  const file = await openFile(schema, project, body.file, body.fingerprint);
  const listed = variablesOf(schema, file.spec);
  const pairs = new Map(Object.entries(body.values ?? {}));
  const masked = new Set(body.masked ?? []);
  const kept = new Set<string>();
  const generate: string[] = [];
  const errors: EditProblem[] = [];
  if (!body.allowUnknown)
    for (const key of pairs.keys())
      if (!listed.has(key))
        errors.push({ key, message: `is not one of ${body.file}'s variables` });
  for (const key of new Set(body.generate ?? [])) {
    // A generated value never replaces one that is set, when asked so: no
    // rotation by accident.
    const current = body.keepExisting ? getValue(file.doc, key) : undefined;
    if (current && listed.has(key)) {
      kept.add(key);
      pairs.set(key, current);
      continue;
    }
    generate.push(key);
    const declared = Object.hasOwn(schema.variables, key);
    const problem = listed.has(key)
      ? generatableProblem(schema.variables[key], declared)
      : `is not one of ${body.file}'s variables`;
    if (problem) {
      errors.push({ key, message: problem });
      continue;
    }
    const made = generateValue(schema.variables[key]!);
    if (made.ok) pairs.set(key, made.value);
    else errors.push({ key, message: made.message });
  }
  if (errors.length) throw refused('invalid', errors);

  const context = await editContext(schema, project);
  const { asked, options } = replacing(body);
  const result = await setValues(context, file, pairs, { ...options, kept });
  if (!result.ok && result.kind === 'cancelled' && asked.length)
    throw toConfirm(asked);
  if (!result.ok) throw await failure(schema, project, file, result);

  const changed = result.keys.filter((entry) => entry.status !== 'unchanged');
  const history = await recordHistory(
    project.statePath,
    actor,
    setChanges(schema, file, result, { masked }),
  );
  const warnings = [...(result.stateError ?? []), ...history.warnings];
  return {
    file: body.file,
    fingerprint: fingerprintAfter(file, changed.length > 0),
    keys: result.keys.map(({ key, status, spec, plain }) => ({
      key,
      status,
      value: maskValue(
        masked.has(key) ? { ...spec, secret: true } : spec,
        plain,
      ),
    })),
    replaced: result.replaced,
    generated: generate,
    changes: history.ids,
    warnings,
    ...(result.stateError ? { stateError: result.stateError } : {}),
  };
}

/** Removes keys from one file: POST /api/values/unset. */
export async function unsetFileValues(
  schema: EnvSchema,
  project: Project,
  body: z.output<typeof unsetValuesRequest>,
  actor: ChangeActor = 'portal',
): Promise<ValuesEdit> {
  const file = await openFile(schema, project, body.file, body.fingerprint);
  const context = await editContext(schema, project);
  const { asked, options } = replacing(body);
  const result = await unsetValues(context, file, body.keys, options);
  if (!result.ok && result.kind === 'cancelled' && asked.length)
    throw toConfirm(asked);
  if (!result.ok) throw await failure(schema, project, file, result);

  const removed = result.keys.filter((entry) => entry.status === 'removed');
  const history = await recordHistory(
    project.statePath,
    actor,
    unsetChanges(schema, file, result),
  );
  const warnings = [...(result.stateError ?? []), ...history.warnings];
  return {
    file: body.file,
    fingerprint: fingerprintAfter(file, removed.length > 0),
    keys: result.keys,
    replaced: result.replaced,
    generated: [],
    changes: history.ids,
    warnings,
    ...(result.stateError ? { stateError: result.stateError } : {}),
  };
}
