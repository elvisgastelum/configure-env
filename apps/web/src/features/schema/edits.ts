// Schema edits: what the portal asks the API to change in env.schema.json.
// An edit is previewed in the browser with the core's own schema writer
// (`@configure-env/core/schema`), the code the API writes it with, so the
// review shows exactly the document the API will validate; then it is sent
// through the T14 write endpoints against the fingerprint it was based on.

import {
  type Schema,
  type SchemaError,
  addFile,
  addVariable,
  removeFile,
  removeVariable,
  renameVariable,
  reorderVariables,
  updateFile,
  updateVariable,
} from '@configure-env/api-client';
import * as writer from '@configure-env/core/schema';
import type {
  FileInput,
  SchemaDocument,
  SchemaEditResult,
  VariableInput,
} from '@configure-env/core/schema';
import { ApiRequestError, unwrap } from '../../lib/api';

/** Field changes: a value sets the field, null removes it. */
export type Changes = Record<string, unknown>;

export type SchemaEdit =
  | {
      kind: 'addVariable';
      name: string;
      spec: VariableInput;
      /** Files whose variable list it joins. */
      files?: string[];
    }
  | {
      kind: 'updateVariable';
      name: string;
      changes: Changes;
      /** The new name, when the edit renames it too. */
      rename?: string;
    }
  | { kind: 'removeVariable'; name: string; cleanup: boolean }
  | { kind: 'reorderVariables'; order: string[] }
  | { kind: 'addFile'; spec: FileInput }
  | { kind: 'updateFile'; path: string; changes: Changes }
  | { kind: 'removeFile'; path: string };

const hasChanges = (changes: Changes) => Object.keys(changes).length > 0;

/** The document the edit makes, validated as a whole, or its errors. */
export function previewEdit(
  document: SchemaDocument,
  edit: SchemaEdit,
): SchemaEditResult {
  switch (edit.kind) {
    case 'addVariable':
      return writer.addVariable(document, edit.name, edit.spec, {
        files: edit.files ?? [],
      });
    case 'updateVariable': {
      const updated = hasChanges(edit.changes)
        ? writer.updateVariable(document, edit.name, edit.changes)
        : writer.validateDocument(document);
      if (!updated.ok || !edit.rename || edit.rename === edit.name)
        return updated;
      return writer.renameVariable(updated.document, edit.name, edit.rename);
    }
    case 'removeVariable':
      return writer.removeVariable(document, edit.name, {
        cleanup: edit.cleanup,
      });
    case 'reorderVariables':
      return writer.reorderVariables(document, edit.order);
    case 'addFile':
      return writer.addFile(document, edit.spec);
    case 'updateFile':
      return writer.updateFile(document, edit.path, edit.changes);
    case 'removeFile':
      return writer.removeFile(document, edit.path);
  }
}

/**
 * A change that was written, whose rename then failed: the schema the change
 * wrote (with its new fingerprint) and why the rename failed.
 */
export class PartialWriteError extends Error {
  constructor(
    readonly written: Schema,
    readonly failure: unknown,
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = 'PartialWriteError';
  }
}

/** The schema an edit wrote before the rest of it failed, if any. */
export const writtenBeforeFailure = (error: unknown) =>
  error instanceof PartialWriteError ? error.written : undefined;

/**
 * A schema the API wrote, with the ids of the history changes the edit
 * recorded: two for a change and a rename, which an undo takes back whole.
 */
export interface SavedSchema extends Schema {
  changes: number[];
}

const saved = (schema: Schema, earlier?: Schema): SavedSchema => ({
  ...schema,
  changes: [earlier, schema].flatMap((written) =>
    written?.change === undefined ? [] : [written.change],
  ),
});

/**
 * Sends the edit against `fingerprint` and resolves to the schema written,
 * with the history changes it recorded.
 * A change and a rename are two writes, the rename against the fingerprint
 * the change returned; the API has no single write for both. The preview
 * checked a snapshot, so the rename can still fail after the change was
 * written (the name was taken meanwhile, the schema changed, the network
 * failed): that rejects with a PartialWriteError carrying the schema the
 * change wrote, so the caller can show it and retry the rename alone.
 */
export async function sendEdit(
  edit: SchemaEdit,
  fingerprint: string,
): Promise<SavedSchema> {
  switch (edit.kind) {
    case 'addVariable':
      return saved(
        await unwrap(
          addVariable({
            fingerprint,
            name: edit.name,
            spec: edit.spec as Record<string, unknown>,
            ...(edit.files?.length ? { files: edit.files } : {}),
          }),
        ),
      );
    case 'updateVariable': {
      const renames = Boolean(edit.rename) && edit.rename !== edit.name;
      let schema: Schema | undefined;
      if (hasChanges(edit.changes) || !renames)
        schema = await unwrap(
          updateVariable(edit.name, { fingerprint, changes: edit.changes }),
        );
      if (!renames) return saved(schema!);
      try {
        return saved(
          await unwrap(
            renameVariable(edit.name, {
              fingerprint: schema?.fingerprint ?? fingerprint,
              to: edit.rename!,
            }),
          ),
          schema,
        );
      } catch (error) {
        if (schema) throw new PartialWriteError(schema, error);
        throw error;
      }
    }
    case 'removeVariable':
      return saved(
        await unwrap(
          removeVariable(edit.name, {
            fingerprint,
            ...(edit.cleanup ? { cleanup: true } : {}),
          }),
        ),
      );
    case 'reorderVariables':
      return saved(
        await unwrap(reorderVariables({ fingerprint, order: edit.order })),
      );
    case 'addFile':
      return saved(
        await unwrap(
          addFile({ fingerprint, spec: edit.spec as Record<string, unknown> }),
        ),
      );
    case 'updateFile':
      return saved(
        await unwrap(
          updateFile({ fingerprint, path: edit.path, changes: edit.changes }),
        ),
      );
    case 'removeFile':
      return saved(await unwrap(removeFile({ fingerprint, path: edit.path })));
  }
}

function bodyOf(
  error: unknown,
): { errors?: SchemaError[]; schema?: Schema } | undefined {
  if (error instanceof PartialWriteError) return bodyOf(error.failure);
  return error instanceof ApiRequestError &&
    typeof error.body === 'object' &&
    error.body !== null
    ? (error.body as { errors?: SchemaError[]; schema?: Schema })
    : undefined;
}

/** The errors of a write the API refused as invalid (422), with their paths. */
export function refusedErrors(error: unknown): SchemaError[] | undefined {
  if (statusOf(error) !== 422) return;
  return bodyOf(error)?.errors;
}

/** The schema as it is now, from a write refused as stale (409). */
export function staleSchema(error: unknown): Schema | undefined {
  if (statusOf(error) !== 409) return;
  return bodyOf(error)?.schema;
}

/** The API's status for the write that failed, through a partial write. */
function statusOf(error: unknown): number | undefined {
  if (error instanceof PartialWriteError) return statusOf(error.failure);
  return error instanceof ApiRequestError ? error.status : undefined;
}

/** The schema's document when the schema is valid; undefined otherwise. */
export const validDocument = (schema: Schema | undefined) =>
  schema?.valid ? (schema.document as SchemaDocument) : undefined;
