// The history of edits in the state database (the `changes` table of
// db-schema.ts): who changed which key of which file, or the schema, and
// how. A row holds salted HMACs of the values before and after and previews
// of them: a secret's preview is a fixed mask, and any other value is cut
// short. A secret's value is never kept, so a change to it cannot be undone;
// a change to a variable that is not secret keeps its values in plain text,
// and a change to the schema its text, so they can be.

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { type SQL, and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import {
  type BetterSQLite3Database,
  drizzle,
} from 'drizzle-orm/better-sqlite3';
import type { VariableSpec } from '../schema/definition.ts';
import { schemaFingerprint } from '../writer/store.ts';
import * as tables from './db-schema.ts';
import {
  type ChangeRow,
  fingerprint,
  loadState,
  withStateTransaction,
} from './state.ts';

/** Who made an edit. */
export type ChangeActor = 'cli' | 'portal';

/**
 * How an edit changed a key: `replace` replaced a protected value; `schema`
 * wrote the schema file.
 */
export type ChangeOperation = 'set' | 'unset' | 'replace' | 'schema';

/**
 * One key an edit changed, with its values: a secret's never reach the
 * database, nor do those of a key the schema does not declare; any other's
 * do, so the change can be undone.
 */
export interface ValueChangeInput {
  file: string;
  key: string;
  operation: Exclude<ChangeOperation, 'schema'>;
  /**
   * The spec the schema declares for the key, whichever file holds it: a
   * secret's previews are masked, its values never kept.
   */
  spec: VariableSpec;
  /**
   * The schema does not declare the key (a stray credential, say): its
   * previews are masked and its values never kept, as a secret's.
   */
  undeclared?: boolean | undefined;
  /** The value before; absent when the key was not set. */
  before?: string | undefined;
  /** The value after; absent when the key is no longer set. */
  after?: string | undefined;
  /** The change this one undid. */
  undoOf?: number | undefined;
}

/** A write of the schema file, with its text before and after. */
export interface SchemaChangeInput {
  /** The schema file, relative to the project root. */
  file: string;
  operation: 'schema';
  /** The text before; absent when the file did not exist. */
  before?: string | undefined;
  after: string;
  /** The change this one undid. */
  undoOf?: number | undefined;
}

/** One change an edit made, as `recordChanges` takes it. */
export type ChangeInput = ValueChangeInput | SchemaChangeInput;

/** A recorded edit, as `readChanges` returns it. */
export type ChangeRecord = typeof tables.changes.$inferSelect;

/** Why a secret's change cannot be undone. */
export const SECRET_UNDO_REASON =
  "the value is secret and is never stored, so this change can't be undone";

/** Why the creation of the schema file is not undone. */
export const SCHEMA_CREATE_UNDO_REASON =
  "the schema file did not exist before this change; undoing it would delete the file, so it can't be undone here";

/** Why the change of a key the schema does not declare cannot be undone. */
export const UNDECLARED_UNDO_REASON =
  "the schema does not declare this key, so its value is not kept and this change can't be undone";

/** Why a change recorded before values were kept cannot be undone. */
export const LEGACY_UNDO_REASON =
  "this change was recorded before the history kept values, so it can't be undone";

/**
 * Whether `change` is a secret's: its previews are masked, its values never
 * kept. A change recorded before the history said why a value was not kept
 * (`not_kept` null, not restorable) is a secret's when a preview is the
 * mask, as only a secret's was.
 */
export function isSecretChange(change: ChangeRecord): boolean {
  if (change.notKept !== null) return change.notKept === 'secret';
  return (
    !change.restorable &&
    (change.beforePreview === SECRET_PREVIEW ||
      change.afterPreview === SECRET_PREVIEW)
  );
}

/** Why `change` cannot be undone; undefined when it can. */
export function undoBlocker(change: ChangeRecord): string | undefined {
  if (change.restorable) return undefined;
  if (isSecretChange(change)) return SECRET_UNDO_REASON;
  switch (change.notKept) {
    case 'undeclared':
      return UNDECLARED_UNDO_REASON;
    case 'schema-created':
      return SCHEMA_CREATE_UNDO_REASON;
    default:
      return LEGACY_UNDO_REASON;
  }
}

/** The mask a secret's preview is: it tells nothing of the value. */
export const SECRET_PREVIEW = '••••';

/** The longest preview of a value that is not secret, in characters. */
export const PREVIEW_LENGTH = 64;

/** A value as the history shows it. */
export function previewOf(spec: VariableSpec, value: string): string {
  if (spec.secret) return SECRET_PREVIEW;
  const chars = [...value];
  return chars.length > PREVIEW_LENGTH
    ? `${chars.slice(0, PREVIEW_LENGTH - 1).join('')}…`
    : chars.join('');
}

/**
 * A schema's text as the history shows it: how many variables and files it
 * declares, or that it is not valid JSON.
 */
export function schemaPreviewOf(text: string): string {
  let document: unknown;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return 'not valid JSON';
  }
  const size = (field: string) => {
    const value =
      document && typeof document === 'object'
        ? (document as Record<string, unknown>)[field]
        : undefined;
    if (Array.isArray(value)) return value.length;
    return value && typeof value === 'object' ? Object.keys(value).length : 0;
  };
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(size('variables'), 'variable')}, ${plural(size('files'), 'file')}`;
}

/** The row a change is recorded as, under the state's `salt`. */
function rowOf(
  salt: string,
  actor: ChangeActor,
  change: ChangeInput,
  at: string,
): ChangeRow {
  const common = {
    actor,
    file: change.file,
    at,
    undoOf: change.undoOf ?? null,
  };
  if (change.operation === 'schema')
    return {
      ...common,
      key: '',
      operation: 'schema',
      beforeFingerprint:
        change.before === undefined ? null : schemaFingerprint(change.before),
      afterFingerprint: schemaFingerprint(change.after),
      beforePreview:
        change.before === undefined ? null : schemaPreviewOf(change.before),
      afterPreview: schemaPreviewOf(change.after),
      beforeValue: change.before ?? null,
      afterValue: change.after,
      // Undoing the creation would delete the file: not done from here.
      restorable: change.before !== undefined,
      notKept: change.before === undefined ? 'schema-created' : null,
    };
  // A secret's value, or an undeclared key's, never reaches the database.
  const notKept = change.spec.secret
    ? 'secret'
    : change.undeclared
      ? 'undeclared'
      : null;
  const side = (value: string | undefined) =>
    value === undefined
      ? { fingerprint: null, preview: null, value: null }
      : {
          fingerprint: fingerprint(salt, value),
          preview: notKept ? SECRET_PREVIEW : previewOf(change.spec, value),
          value: notKept ? null : value,
        };
  const before = side(change.before);
  const after = side(change.after);
  return {
    ...common,
    key: change.key,
    operation: change.operation,
    beforeFingerprint: before.fingerprint,
    afterFingerprint: after.fingerprint,
    beforePreview: before.preview,
    afterPreview: after.preview,
    beforeValue: before.value,
    afterValue: after.value,
    restorable: notKept === null,
    notKept,
  };
}

/**
 * Appends `changes` to the history in the state database at `path`, in one
 * write transaction; a database without a salt gets one first, so the
 * fingerprints can be compared with later ones. Resolves to the ids of the
 * rows, in order.
 */
export async function recordChanges(
  path: string,
  actor: ChangeActor,
  changes: readonly ChangeInput[],
  now: Date = new Date(),
): Promise<number[]> {
  if (!changes.length) return [];
  return withStateTransaction(path, (tx) => {
    if (!tx.exists) tx.write(tx.state);
    const { salt } = tx.state;
    return tx.insertChanges(
      changes.map((change) => rowOf(salt, actor, change, now.toISOString())),
    );
  });
}

/**
 * Reads the history; undefined when there is none yet. A database an older
 * version wrote is migrated first, as any read of the state does.
 */
async function openHistory<T>(
  path: string,
  read: (db: BetterSQLite3Database<typeof tables>) => T,
): Promise<T | undefined> {
  if (!existsSync(path)) return undefined;
  const loaded = await loadState(path);
  if (!loaded.ok) throw new Error(loaded.message);
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const table = sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get('changes');
    if (!table) return undefined;
    return read(drizzle(sqlite, { schema: tables }));
  } finally {
    sqlite.close();
  }
}

/** The history in the state database at `path`, oldest first; empty without one. */
export async function readChanges(path: string): Promise<ChangeRecord[]> {
  return (
    (await openHistory(path, (db) =>
      db.select().from(tables.changes).orderBy(asc(tables.changes.id)).all(),
    )) ?? []
  );
}

/** One recorded change by id; undefined when there is none. */
export async function readChange(
  path: string,
  id: number,
): Promise<ChangeRecord | undefined> {
  return openHistory(path, (db) =>
    db.select().from(tables.changes).where(eq(tables.changes.id, id)).get(),
  );
}

/**
 * Which changes `queryChanges` returns: all of them by default. `from` and
 * `to` are ISO dates or timestamps, both included: a date alone covers its
 * whole UTC day. `page` counts from 1.
 */
export interface ChangeFilter {
  file?: string | undefined;
  key?: string | undefined;
  actor?: ChangeActor | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/** One page of the history, newest first, with how many changes match. */
export interface ChangePage {
  changes: ChangeRecord[];
  total: number;
  page: number;
  limit: number;
}

/** The changes a page holds when the filter names no limit. */
export const DEFAULT_CHANGE_LIMIT = 50;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The changes that match `filter`, newest first, one page of them. */
export async function queryChanges(
  path: string,
  filter: ChangeFilter = {},
): Promise<ChangePage> {
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const limit = Math.max(1, Math.trunc(filter.limit ?? DEFAULT_CHANGE_LIMIT));
  const { changes } = tables;
  const where: SQL[] = [];
  if (filter.file !== undefined) where.push(eq(changes.file, filter.file));
  if (filter.key !== undefined) where.push(eq(changes.key, filter.key));
  if (filter.actor !== undefined) where.push(eq(changes.actor, filter.actor));
  if (filter.from !== undefined)
    where.push(
      gte(
        changes.at,
        DATE_ONLY.test(filter.from)
          ? `${filter.from}T00:00:00.000Z`
          : new Date(filter.from).toISOString(),
      ),
    );
  if (filter.to !== undefined)
    where.push(
      lte(
        changes.at,
        DATE_ONLY.test(filter.to)
          ? `${filter.to}T23:59:59.999Z`
          : new Date(filter.to).toISOString(),
      ),
    );
  const condition = where.length ? and(...where) : undefined;
  return (
    (await openHistory(path, (db) => ({
      changes: db
        .select()
        .from(changes)
        .where(condition)
        .orderBy(desc(changes.id))
        .limit(limit)
        .offset((page - 1) * limit)
        .all(),
      total: db.select({ n: count() }).from(changes).where(condition).get()!.n,
      page,
      limit,
    }))) ?? { changes: [], total: 0, page, limit }
  );
}
