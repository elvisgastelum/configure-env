// The state of protected variables on this machine: a salted HMAC of each
// protected value a write command wrote or found, never the value itself.
// It lets a command tell a restored value from a new one after the env file
// that held it was deleted.
//
// It lives in one SQLite database per project (.configure-env/state.db,
// tables in db-schema.ts), which also holds the history of edits. A run that
// writes it holds a SQLite write transaction (BEGIN IMMEDIATE) instead of a
// lock file: SQLite releases it when the run ends, even when it crashes. The
// state.json of earlier versions is imported by the first write, then
// removed.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import {
  type BetterSQLite3Database,
  drizzle,
} from 'drizzle-orm/better-sqlite3';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import { z } from 'zod';
import { VARIABLE_NAME } from '../schema/definition.ts';
import { formatIssuePath } from '../schema/load.ts';
import * as tables from './db-schema.ts';

/** Where the state lives, relative to the project root. */
export const DEFAULT_STATE_PATH = '.configure-env/state.db';

/** The file earlier versions kept the state in, next to the database. */
export const LEGACY_STATE_NAME = 'state.json';

/** The state.json a database at `path` imports. */
export const legacyStatePath = (path: string) =>
  join(dirname(path), LEGACY_STATE_NAME);

export const STATE_VERSION = 1;

/** The bytes of a state's salt. */
export const SALT_BYTES = 32;

const salt = z.string().refine((text) => {
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === SALT_BYTES && bytes.toString('base64') === text;
}, `must be ${SALT_BYTES} bytes in base64`);

const fingerprintEntry = z.strictObject({
  hmac: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex digits'),
  recordedAt: z.iso.datetime({ message: 'must be an ISO date' }),
});

const stateSchema = z.strictObject({
  version: z.literal(STATE_VERSION, { error: 'must be 1' }),
  salt,
  fingerprints: z.record(
    z.string().min(1),
    z.record(z.string().regex(VARIABLE_NAME), fingerprintEntry),
  ),
});

/** One recorded value: its HMAC and when it was recorded. */
export type Fingerprint = z.output<typeof fingerprintEntry>;

/** Fingerprints by schema file path, then by variable name. */
export type State = z.output<typeof stateSchema>;

export type StateResult =
  { ok: true; state: State; exists: boolean } | { ok: false; message: string };

/** A state with no fingerprint and a new salt, written on first use. */
export const emptyState = (): State => ({
  version: STATE_VERSION,
  salt: randomBytes(SALT_BYTES).toString('base64'),
  fingerprints: {},
});

const codeOf = (error: unknown) =>
  (error as NodeJS.ErrnoException).code ?? String(error);

/**
 * Reads a state.json of earlier versions: undefined when it does not exist.
 * Anything else that is not a valid state is an error naming the path.
 */
export function readLegacyState(path: string): StateResult | undefined {
  const fail = (message: string) => ({
    ok: false as const,
    message: `${path}: ${message}`,
  });
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink())
      return fail('is a symlink; refusing to read through it');
    if (!stats.isFile()) return fail('is not a regular file');
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined;
    return fail(`cannot read it: ${codeOf(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return error instanceof SyntaxError
      ? fail('is not valid JSON')
      : fail(`cannot read it: ${codeOf(error)}`);
  }
  return validState(json, fail);
}

/** `value` as a state, or the first problem through `fail`. */
function validState(
  value: unknown,
  fail: (message: string) => { ok: false; message: string },
): StateResult {
  const result = stateSchema.safeParse(value);
  if (result.success) return { ok: true, state: result.data, exists: true };
  const [issue] = result.error.issues;
  return fail(`${formatIssuePath(issue!.path)}: ${issue!.message}`);
}

/**
 * The UTC day a fingerprint was recorded, as YYYY-MM-DD: the date part of
 * its ISO timestamp, never the local date.
 */
export const recordedDay = (recordedAt: string) => recordedAt.slice(0, 10);

/** The hex HMAC-SHA-256 of `value` under the state's salt. */
export const fingerprint = (salt: string, value: string) =>
  createHmac('sha256', Buffer.from(salt, 'base64'))
    .update(value, 'utf8')
    .digest('hex');

/** The fingerprint recorded for `key` in `file`, if any. */
export const recorded = (
  state: State,
  file: string,
  key: string,
): Fingerprint | undefined =>
  Object.hasOwn(state.fingerprints, file) &&
  Object.hasOwn(state.fingerprints[file]!, key)
    ? state.fingerprints[file]![key]
    : undefined;

/** Whether `value` is the one recorded for `key` in `file`; compared in constant time. */
export function matchesFingerprint(
  state: State,
  file: string,
  key: string,
  value: string,
): boolean {
  const entry = recorded(state, file, key);
  if (!entry) return false;
  const expected = Buffer.from(entry.hmac, 'hex');
  const actual = Buffer.from(fingerprint(state.salt, value), 'hex');
  return timingSafeEqual(expected, actual);
}

/**
 * Records `value` for `key` in `file`. A value already recorded keeps its
 * date. True when the state changed.
 */
export function recordFingerprint(
  state: State,
  file: string,
  key: string,
  value: string,
  now: Date = new Date(),
): boolean {
  if (matchesFingerprint(state, file, key, value)) return false;
  state.fingerprints[file] ??= {};
  state.fingerprints[file][key] = {
    hmac: fingerprint(state.salt, value),
    recordedAt: now.toISOString(),
  };
  return true;
}

/** Forgets `key` in `file`; true when it was recorded. */
export function removeFingerprint(
  state: State,
  file: string,
  key: string,
): boolean {
  if (!recorded(state, file, key)) return false;
  delete state.fingerprints[file]![key];
  if (!Object.keys(state.fingerprints[file]!).length)
    delete state.fingerprints[file];
  return true;
}

/**
 * One change a run makes: record a value (over a different recorded one
 * only when it `replace`s it), or remove the record. Applied to the state on
 * disk, so it holds the value until then, never writing it.
 */
export type StateChange =
  | {
      action: 'record';
      file: string;
      key: string;
      value: string;
      replace: boolean;
      at?: Date;
    }
  | { action: 'remove'; file: string; key: string };

/**
 * Applies the changes to `state`: a value is recorded where none is, or over
 * a different one it replaces; a recorded value keeps its date. True when
 * the state changed.
 */
export function applyChanges(
  state: State,
  changes: readonly StateChange[],
): boolean {
  let changed = false;
  for (const change of changes) {
    const { file, key } = change;
    if (change.action === 'remove') {
      if (removeFingerprint(state, file, key)) changed = true;
    } else if (!recorded(state, file, key) || change.replace) {
      if (recordFingerprint(state, file, key, change.value, change.at))
        changed = true;
    }
  }
  return changed;
}

/** How long a run waits for another run's write transaction before it gives up. */
export const LOCK_WAIT_MS = 2_000;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the migrations are looked for: `migrations` next to the module (the
 * published CLI copies them into dist/), then the core's sources.
 */
export const MIGRATION_DIRS = [
  join(here, 'migrations'),
  join(here, '..', '..', 'drizzle'),
];

let migrationCache: MigrationMeta[] | undefined;

/** The migrations drizzle-kit generated, in order. */
export function stateMigrations(): MigrationMeta[] {
  if (migrationCache) return migrationCache;
  const dir = MIGRATION_DIRS.find((candidate) =>
    existsSync(join(candidate, 'meta', '_journal.json')),
  );
  if (!dir)
    throw new Error(
      'the state database migrations are missing; reinstall configure-env',
    );
  return (migrationCache = readMigrationFiles({ migrationsFolder: dir }));
}

/** The schema version of a database migrated by this version. */
export const stateSchemaVersion = () => stateMigrations().length;

type Db = BetterSQLite3Database<typeof tables>;

/** An error SQLite reports while another connection writes. */
const isBusy = (error: unknown) =>
  /^SQLITE_(BUSY|LOCKED)/.test(String((error as { code?: unknown }).code));

/** Another run held the database's write transaction past the wait. */
export class StateBusyError extends Error {
  constructor(path: string) {
    super(`${path}: in use by another run; try again`);
    this.name = 'StateBusyError';
  }
}

/** An error with a message for people, naming `path`. */
function stateError(path: string, error: unknown): Error {
  const code = String((error as { code?: unknown }).code ?? '');
  if (error instanceof StateBusyError) return error;
  if (isBusy(error)) return new StateBusyError(path);
  if (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT'))
    return new Error(`${path}: is not a valid state database`);
  const message = (error as Error).message ?? String(error);
  return new Error(
    message.startsWith(`${path}: `) ? message : `${path}: ${message}`,
  );
}

/**
 * Whether the database file exists; a symlink or anything other than a
 * regular file is refused.
 */
function databaseExists(path: string): boolean {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink())
      throw new Error(`${path}: is a symlink; refusing to use it`);
    if (!stats.isFile()) throw new Error(`${path}: is not a regular file`);
    return true;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Creates the database file with mode 600 when missing; its directory gets 700. */
async function createDatabaseFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.close();
  } catch (error) {
    if (codeOf(error) !== 'EEXIST') throw error;
  }
}

/** The database's schema version: 0 before its first migration. */
function schemaVersion(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
    .get('meta');
  if (!table) return 0;
  const row = sqlite
    .prepare("select value from meta where key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

/**
 * Applies the migrations the database lacks; the caller holds its write
 * transaction. A database of a newer version is refused, never changed.
 */
function migrate(sqlite: Database.Database): void {
  const migrations = stateMigrations();
  const version = schemaVersion(sqlite);
  if (!Number.isInteger(version) || version < 0)
    throw new Error('has an invalid schema version');
  if (version > migrations.length)
    throw new Error(
      `has schema version ${version}, newer than this configure-env knows (${migrations.length}); upgrade configure-env`,
    );
  if (version === migrations.length) return;
  for (const migration of migrations.slice(version))
    for (const statement of migration.sql)
      if (statement.trim()) sqlite.exec(statement);
  sqlite
    .prepare(
      "insert into meta (key, value) values ('schema_version', ?) on conflict (key) do update set value = excluded.value",
    )
    .run(String(migrations.length));
}

/** The state the database holds; `exists` is false before its first write. */
function readState(db: Db): StateResult {
  const fail = (message: string) => ({ ok: false as const, message });
  const saltRow = db
    .select()
    .from(tables.meta)
    .where(eq(tables.meta.key, 'salt'))
    .get();
  const rows = db.select().from(tables.protectedFingerprints).all();
  if (!saltRow) {
    if (rows.length) return fail('holds fingerprints without a salt');
    return { ok: true, state: emptyState(), exists: false };
  }
  const fingerprints: Record<string, Record<string, Fingerprint>> = {};
  for (const row of rows) {
    fingerprints[row.file] ??= {};
    fingerprints[row.file]![row.key] = {
      hmac: row.hmac,
      recordedAt: row.recordedAt,
    };
  }
  return validState(
    { version: STATE_VERSION, salt: saltRow.value, fingerprints },
    fail,
  );
}

/** Replaces what the database holds with `state`. */
function writeAll(db: Db, state: State): void {
  db.insert(tables.meta)
    .values({ key: 'salt', value: state.salt })
    .onConflictDoUpdate({
      target: tables.meta.key,
      set: { value: state.salt },
    })
    .run();
  db.delete(tables.protectedFingerprints).run();
  const rows = Object.entries(state.fingerprints).flatMap(([file, keys]) =>
    Object.entries(keys).map(([key, entry]) => ({
      file,
      key,
      hmac: entry.hmac,
      recordedAt: entry.recordedAt,
    })),
  );
  // One statement per row keeps clear of SQLite's bound-parameter limit.
  for (const row of rows)
    db.insert(tables.protectedFingerprints).values(row).run();
}

/**
 * Imports the state.json next to the database, under its write
 * transaction: into an empty database as it is, into one with the same salt
 * only the entries it lacks (a run that crashed after importing it, before
 * removing it). Every entry is then checked to be in the database. Returns
 * the path to remove once the transaction commits; undefined when there is
 * none.
 */
function importLegacy(db: Db, path: string): string | undefined {
  const legacy = legacyStatePath(path);
  if (legacy === path) return undefined;
  const result = readLegacyState(legacy);
  if (!result) return undefined;
  if (!result.ok) throw new Error(result.message);
  const json = result.state;
  const current = readState(db);
  if (!current.ok) throw new Error(`${path}: ${current.message}`);
  if (!current.exists) writeAll(db, json);
  else if (current.state.salt !== json.salt)
    throw new Error(
      `${legacy}: its salt differs from the one in ${path}; remove one of them`,
    );
  else
    for (const [file, keys] of Object.entries(json.fingerprints))
      for (const [key, entry] of Object.entries(keys))
        db.insert(tables.protectedFingerprints)
          .values({ file, key, hmac: entry.hmac, recordedAt: entry.recordedAt })
          .onConflictDoNothing()
          .run();
  // Verify before the import commits.
  for (const [file, keys] of Object.entries(json.fingerprints))
    for (const key of Object.keys(keys)) {
      const row = db
        .select()
        .from(tables.protectedFingerprints)
        .where(
          and(
            eq(tables.protectedFingerprints.file, file),
            eq(tables.protectedFingerprints.key, key),
          ),
        )
        .get();
      if (!row) throw new Error(`${legacy}: ${file} ${key} was not imported`);
    }
  return legacy;
}

/**
 * Takes the database's write lock (BEGIN IMMEDIATE), polling without
 * blocking the event loop until `waitMs` pass; WAL mode is set first.
 */
async function begin(sqlite: Database.Database, waitMs: number) {
  const deadline = Date.now() + waitMs;
  sqlite.pragma('busy_timeout = 0');
  try {
    for (;;) {
      try {
        if (sqlite.pragma('journal_mode', { simple: true }) !== 'wal')
          sqlite.pragma('journal_mode = WAL');
        sqlite.exec('BEGIN IMMEDIATE');
        return;
      } catch (error) {
        if (!isBusy(error) || Date.now() >= deadline) throw error;
        await pause(25);
      }
    }
  } finally {
    sqlite.pragma(`busy_timeout = ${waitMs}`);
  }
}

/** A run's view of the state under its write transaction. */
export interface StateTransaction {
  /** The database's path. */
  path: string;
  /** The state as the transaction read it; a run may change it in place. */
  state: State;
  /** Whether the state had been written before. */
  exists: boolean;
  /** Replaces what the database holds with `state`, in this transaction. */
  write: (state: State) => void;
}

/**
 * Runs `task` holding the database's write transaction: it opens (creating
 * it with mode 600, its directory 700) and migrates the database, imports a
 * state.json left next to it, reads the state, runs `task`, and commits;
 * anything `task` throws rolls it all back. Another run's transaction is
 * waited for up to `waitMs`, then refused. An imported state.json is removed
 * once the transaction commits.
 */
export async function withStateTransaction<T>(
  path: string,
  task: (tx: StateTransaction) => Promise<T> | T,
  { waitMs = LOCK_WAIT_MS }: { waitMs?: number } = {},
): Promise<T> {
  databaseExists(path);
  await createDatabaseFile(path);
  let sqlite: Database.Database;
  try {
    sqlite = new Database(path, { timeout: waitMs });
  } catch (error) {
    throw stateError(path, error);
  }
  try {
    // A file created with another umask, or by SQLite itself.
    await chmod(path, 0o600).catch(() => undefined);
    let value: T;
    let imported: string | undefined;
    try {
      await begin(sqlite, waitMs);
    } catch (error) {
      throw stateError(path, error);
    }
    try {
      const db = drizzle(sqlite, { schema: tables });
      try {
        migrate(sqlite);
        imported = importLegacy(db, path);
      } catch (error) {
        throw stateError(path, error);
      }
      const current = readState(db);
      if (!current.ok) throw new Error(`${path}: ${current.message}`);
      value = await task({
        path,
        state: current.state,
        exists: current.exists,
        write: (state) => writeAll(db, state),
      });
      sqlite.exec('COMMIT');
    } catch (error) {
      if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
      throw error;
    }
    if (imported) await rm(imported, { force: true });
    return value;
  } finally {
    sqlite.close();
  }
}

/**
 * Reads the state at `path`: an empty one when neither the database nor a
 * state.json next to it exists, and the state.json's content while only it
 * does (the first write imports it). Anything that is not a valid state is
 * an error naming the path; it is never guessed at or replaced.
 */
export async function loadState(path: string): Promise<StateResult> {
  let exists: boolean;
  try {
    exists = databaseExists(path);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (!exists)
    return (
      readLegacyState(legacyStatePath(path)) ?? {
        ok: true,
        state: emptyState(),
        exists: false,
      }
    );
  try {
    const sqlite = new Database(path, { fileMustExist: true });
    try {
      const current =
        schemaVersion(sqlite) === stateSchemaVersion() &&
        !existsSync(legacyStatePath(path))
          ? readState(drizzle(sqlite, { schema: tables }))
          : undefined;
      if (current)
        return current.ok
          ? current
          : { ok: false, message: `${path}: ${current.message}` };
    } finally {
      sqlite.close();
    }
    // Not migrated yet, or a state.json left to import: a write does both.
    return await withStateTransaction(path, (tx) => ({
      ok: true,
      state: tx.state,
      exists: tx.exists,
    }));
  } catch (error) {
    return { ok: false, message: stateError(path, error).message };
  }
}

/** Writes the state, replacing what the database holds, in one transaction. */
export async function writeState(path: string, state: State): Promise<void> {
  await withStateTransaction(path, (tx) => tx.write(state));
}

/** Writes the state; tests pass one that fails. */
export type StateWriter = (path: string, state: State) => Promise<void>;

/**
 * Applies changes to the state of a write transaction: it keeps the salt and
 * every entry the changes do not touch, and writes only when it changed,
 * through `write` when given. True when it wrote it.
 */
export async function mergeState(
  tx: StateTransaction,
  changes: readonly StateChange[],
  write?: StateWriter,
): Promise<boolean> {
  if (!applyChanges(tx.state, changes)) return false;
  if (write) await write(tx.path, tx.state);
  else tx.write(tx.state);
  return true;
}

/**
 * Applies a run's changes to the state in one write transaction: it re-reads
 * the state, keeps its salt and every entry the changes do not touch, and
 * writes it only when it changed. Parallel runs so keep each other's
 * fingerprints. True when it wrote the state.
 */
export async function updateState(
  path: string,
  changes: readonly StateChange[],
  {
    waitMs = LOCK_WAIT_MS,
    write,
  }: { waitMs?: number; write?: StateWriter } = {},
): Promise<boolean> {
  if (!changes.length) return false;
  return withStateTransaction(path, (tx) => mergeState(tx, changes, write), {
    waitMs,
  });
}
