// The changes each write records in the history (engine/history.ts), and
// undoing one: a change is undone only while what it wrote is still there,
// checked by fingerprint, and the undo is itself recorded as a change.

import { readFile } from 'node:fs/promises';
import type { ApplyResult } from '../engine/apply.ts';
import { getValue, keysOf, parseDotenv } from '../engine/dotenv.ts';
import {
  type ChangeActor,
  type ChangeRecord,
  type SchemaChangeInput,
  type ValueChangeInput,
  readChange,
  recordChanges,
  undoBlocker,
} from '../engine/history.ts';
import type { Plan } from '../engine/plan.ts';
import { fingerprint, loadState } from '../engine/state.ts';
import type { EnvSchema, VariableSpec } from '../schema/definition.ts';
import { schemaFingerprint, writeSchemaFile } from '../writer/store.ts';
import {
  type EditContext,
  type EditFailure,
  type Edited,
  type SetEntry,
  type UnsetEntry,
  setValues,
  unsetValues,
} from './edit.ts';
import { type EnvFile, UNKNOWN_SPEC, readEnvFile } from './file.ts';
import type { Replaced } from './protect.ts';

/**
 * How the history records `key`: by the spec the schema declares for it,
 * whether or not the file lists it, so a secret stays secret in every file;
 * a key the schema does not declare is `undeclared`, its values never kept.
 */
function declared(
  schema: EnvSchema,
  key: string,
): { spec: VariableSpec; undeclared?: true } {
  return Object.hasOwn(schema.variables, key)
    ? { spec: schema.variables[key]! }
    : { spec: UNKNOWN_SPEC, undeclared: true };
}

/**
 * The keys a `setValues` on `file` changed. `masked` keys are recorded as
 * secrets whatever their spec (a value piped in, say), so their values are
 * never kept.
 */
export function setChanges(
  schema: EnvSchema,
  file: EnvFile,
  result: Edited<SetEntry>,
  { masked, undoOf }: { masked?: ReadonlySet<string>; undoOf?: number } = {},
): ValueChangeInput[] {
  const before = parseDotenv(file.previous ?? '');
  return result.keys
    .filter((entry) => entry.status !== 'unchanged')
    .map((entry) => {
      const { spec, undeclared } = declared(schema, entry.key);
      return {
        file: result.file,
        key: entry.key,
        operation: result.replaced.includes(entry.key) ? 'replace' : 'set',
        spec: masked?.has(entry.key) ? { ...spec, secret: true } : spec,
        ...(undeclared ? { undeclared } : {}),
        before: getValue(before, entry.key),
        after: entry.plain,
        ...(undoOf === undefined ? {} : { undoOf }),
      };
    });
}

/** The keys an `unsetValues` on `file` removed. */
export function unsetChanges(
  schema: EnvSchema,
  file: EnvFile,
  result: Edited<UnsetEntry>,
  { undoOf }: { undoOf?: number } = {},
): ValueChangeInput[] {
  const before = parseDotenv(file.previous ?? '');
  return result.keys
    .filter((entry) => entry.status === 'removed')
    .map(({ key }) => ({
      file: result.file,
      key,
      operation: result.replaced.includes(key) ? 'replace' : 'unset',
      ...declared(schema, key),
      before: getValue(before, key),
      ...(undoOf === undefined ? {} : { undoOf }),
    }));
}

/** The keys an applied plan changed, in the files it wrote. */
export function appliedChanges(
  schema: EnvSchema,
  plan: Plan,
  results: readonly ApplyResult[],
  replaced: readonly Replaced[],
): ValueChangeInput[] {
  const changes: ValueChangeInput[] = [];
  plan.files.forEach((file, index) => {
    if (!results[index]?.written) return;
    const before = parseDotenv(file.previous ?? '');
    const after = parseDotenv(file.content ?? '');
    const keys = new Set([...keysOf(before), ...keysOf(after)]);
    for (const key of keys) {
      const was = getValue(before, key);
      const now = getValue(after, key);
      if (was === now) continue;
      const replacedKey = replaced.some(
        (entry) => entry.file === file.path && entry.key === key,
      );
      changes.push({
        file: file.path,
        key,
        operation: replacedKey
          ? 'replace'
          : now === undefined
            ? 'unset'
            : 'set',
        ...declared(schema, key),
        before: was,
        after: now,
      });
    }
  });
  return changes;
}

/** A write of the schema file: none when its text did not change. */
export function schemaChanges(
  file: string,
  before: string | undefined,
  after: string,
  undoOf?: number,
): SchemaChangeInput[] {
  if (before === after) return [];
  return [
    {
      file,
      operation: 'schema',
      before,
      after,
      ...(undoOf === undefined ? {} : { undoOf }),
    },
  ];
}

/**
 * Records `changes` in the history; a history it cannot write is a warning,
 * never a failure: the edit was made.
 */
export async function recordHistory(
  statePath: string,
  actor: ChangeActor,
  changes: Parameters<typeof recordChanges>[2],
): Promise<{ ids: number[]; warnings: string[] }> {
  try {
    return {
      ids: await recordChanges(statePath, actor, changes),
      warnings: [],
    };
  } catch (error) {
    return {
      ids: [],
      warnings: [`the history was not recorded: ${(error as Error).message}`],
    };
  }
}

/** What an undo runs against. */
export interface UndoContext {
  /** The state database that holds the history. */
  statePath: string;
  /** Who undoes the change: the undo is recorded as theirs. */
  actor: ChangeActor;
  /** The real project root the history's env file paths are relative to. */
  root: string;
  /** The schema file relative to the root, as the history names it. */
  schemaPath: string;
  /** The schema file, absolute. */
  schemaFile: string;
  /** The edit context of a value change; absent while the schema is invalid. */
  edit?: EditContext | undefined;
}

/**
 * Why an undo wrote nothing: no such change (`not-found`), one that cannot
 * be undone (`not-restorable`, a secret's), what it wrote is no longer there
 * (`mismatch`), or the write was refused as an edit is (the EditFailure
 * kinds).
 */
export type UndoFailure =
  | {
      ok: false;
      kind: 'not-found' | 'not-restorable' | 'mismatch';
      message: string;
      change?: ChangeRecord;
    }
  | (EditFailure & { change: ChangeRecord });

/**
 * An undo that wrote the change's previous state: the change it undid, the
 * change recorded for the undo (absent when the history could not be
 * written, which is then a warning), and a state write that failed after
 * the file (`stateError`).
 */
export interface Undone {
  ok: true;
  undone: ChangeRecord;
  change?: ChangeRecord;
  warnings: string[];
  stateError?: string[];
}

/** The salt the history's fingerprints were made with. */
async function saltOf(statePath: string): Promise<string> {
  const loaded = await loadState(statePath);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state.salt;
}

/** Records the undo and reads its row back. */
async function finish(
  context: UndoContext,
  undone: ChangeRecord,
  changes: Parameters<typeof recordChanges>[2],
  stateError?: string[],
): Promise<Undone> {
  const recorded = await recordHistory(
    context.statePath,
    context.actor,
    changes,
  );
  const [id] = recorded.ids;
  const change =
    id === undefined ? undefined : await readChange(context.statePath, id);
  return {
    ok: true,
    undone,
    ...(change ? { change } : {}),
    warnings: recorded.warnings,
    ...(stateError ? { stateError } : {}),
  };
}

const mismatch = (change: ChangeRecord, message: string): UndoFailure => ({
  ok: false,
  kind: 'mismatch',
  message,
  change,
});

const invalid = (change: ChangeRecord, message: string): UndoFailure => ({
  ok: false,
  kind: 'invalid',
  messages: [message],
  change,
});

/** Undoes a change of one key: sets its previous value back, or removes it. */
async function undoValue(
  context: UndoContext,
  change: ChangeRecord,
): Promise<Undone | UndoFailure> {
  const { edit } = context;
  if (!edit)
    return invalid(
      change,
      'the schema is not valid; fix it before undoing a change to a value',
    );
  const spec = edit.schema.files.find((file) => file.path === change.file);
  if (!spec)
    return invalid(
      change,
      `${change.file} is no longer one of the schema's files`,
    );
  const read = await readEnvFile(context.root, spec);
  if (!read.ok)
    return { ok: false, kind: 'write', message: read.message, change };
  const { file } = read;
  const current = getValue(file.doc, change.key);
  const salt = await saltOf(context.statePath);
  const still =
    change.afterFingerprint === null
      ? current === undefined
      : current !== undefined &&
        fingerprint(salt, current) === change.afterFingerprint;
  if (!still)
    return mismatch(
      change,
      current === undefined
        ? `${change.key} is no longer set in ${change.file}, so this change was not undone; it changed after this change was made`
        : `${change.key} in ${change.file} no longer holds the value this change wrote, so it was not undone; it changed after this change was made`,
    );
  // A protected value is secret, so never undone; one that became protected
  // since the change is refused as any edit of it is.
  if (change.beforeFingerprint === null) {
    const result = await unsetValues(edit, file, [change.key]);
    if (!result.ok) return { ...result, change };
    return finish(
      context,
      change,
      unsetChanges(edit.schema, file, result, { undoOf: change.id }),
      result.stateError,
    );
  }
  const result = await setValues(
    edit,
    file,
    new Map([[change.key, change.beforeValue!]]),
  );
  if (!result.ok) return { ...result, change };
  return finish(
    context,
    change,
    setChanges(edit.schema, file, result, { undoOf: change.id }),
    result.stateError,
  );
}

/** Undoes a write of the schema: writes its previous text back. */
async function undoSchema(
  context: UndoContext,
  change: ChangeRecord,
): Promise<Undone | UndoFailure> {
  if (change.file !== context.schemaPath)
    return invalid(change, `${change.file} is not this project's schema file`);
  let current: string;
  try {
    current = await readFile(context.schemaFile, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return code === 'ENOENT'
      ? mismatch(
          change,
          `${change.file} no longer exists, so this change was not undone`,
        )
      : {
          ok: false,
          kind: 'write',
          message: `cannot read ${change.file}: ${code}`,
          change,
        };
  }
  const now = schemaFingerprint(current);
  if (now !== change.afterFingerprint)
    return mismatch(
      change,
      `${change.file} changed after this change was made, so it was not undone`,
    );
  let document: unknown;
  try {
    document = JSON.parse(change.beforeValue!.replace(/^\uFEFF/, ''));
  } catch {
    return invalid(
      change,
      `the schema before this change was not valid JSON, so it is not written back`,
    );
  }
  const written = await writeSchemaFile(
    context.schemaFile,
    document as Parameters<typeof writeSchemaFile>[1],
    { fingerprint: now },
  );
  if (!written.ok) {
    if (written.kind === 'stale')
      return mismatch(
        change,
        `${change.file} changed after this change was made, so it was not undone`,
      );
    const messages = written.errors.map(
      (error) => `${error.path}: ${error.message}`,
    );
    return written.kind === 'invalid'
      ? { ok: false, kind: 'invalid', messages, change }
      : { ok: false, kind: 'write', message: messages.join('; '), change };
  }
  return finish(
    context,
    change,
    schemaChanges(change.file, current, written.file.text, change.id),
  );
}

/**
 * Undoes the change `id` of the history: only while the file still holds
 * what the change wrote (its after-fingerprint), else nothing is written and
 * the answer says why. A secret's change is never undone: its value was not
 * kept. The undo is recorded as a change of `context.actor`'s, naming the
 * one it undid.
 */
export async function undoChange(
  context: UndoContext,
  id: number,
): Promise<Undone | UndoFailure> {
  const change = await readChange(context.statePath, id);
  if (!change)
    return {
      ok: false,
      kind: 'not-found',
      message: `no change ${id} in the history`,
    };
  const blocker = undoBlocker(change);
  if (blocker)
    return { ok: false, kind: 'not-restorable', message: blocker, change };
  return change.operation === 'schema'
    ? undoSchema(context, change)
    : undoValue(context, change);
}
