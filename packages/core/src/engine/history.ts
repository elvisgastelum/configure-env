// The history of edits in the state database (the `changes` table of
// db-schema.ts): who changed which key of which file, and how. A row holds
// salted HMACs of the values before and after and masked previews of them,
// never a value: a secret's preview is a fixed mask, and any other value is
// cut short.

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { VariableSpec } from '../schema/definition.ts';
import * as tables from './db-schema.ts';
import { type ChangeRow, fingerprint, withStateTransaction } from './state.ts';

/** Who made an edit. */
export type ChangeActor = 'cli' | 'portal';

/** How an edit changed a key: `replace` replaced a protected value. */
export type ChangeOperation = 'set' | 'unset' | 'replace';

/** One key an edit changed, with its values; they never reach the database. */
export interface ChangeInput {
  file: string;
  key: string;
  operation: ChangeOperation;
  /** The variable's spec: a secret's previews are masked. */
  spec: VariableSpec;
  /** The value before; absent when the key was not set. */
  before?: string | undefined;
  /** The value after; absent when the key is no longer set. */
  after?: string | undefined;
}

/** A recorded edit, as `readChanges` returns it. */
export type ChangeRecord = typeof tables.changes.$inferSelect;

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
 * Appends `changes` to the history in the state database at `path`, in one
 * write transaction; a database without a salt gets one first, so the
 * fingerprints can be compared with later ones.
 */
export async function recordChanges(
  path: string,
  actor: ChangeActor,
  changes: readonly ChangeInput[],
  now: Date = new Date(),
): Promise<void> {
  if (!changes.length) return;
  await withStateTransaction(path, (tx) => {
    if (!tx.exists) tx.write(tx.state);
    const { salt } = tx.state;
    const side = (spec: VariableSpec, value: string | undefined) =>
      value === undefined
        ? { fingerprint: null, preview: null }
        : {
            fingerprint: fingerprint(salt, value),
            preview: previewOf(spec, value),
          };
    tx.insertChanges(
      changes.map((change): ChangeRow => {
        const before = side(change.spec, change.before);
        const after = side(change.spec, change.after);
        return {
          actor,
          file: change.file,
          key: change.key,
          operation: change.operation,
          beforeFingerprint: before.fingerprint,
          afterFingerprint: after.fingerprint,
          beforePreview: before.preview,
          afterPreview: after.preview,
          at: now.toISOString(),
        };
      }),
    );
  });
}

/** The history in the state database at `path`, oldest first; empty without one. */
export async function readChanges(path: string): Promise<ChangeRecord[]> {
  if (!existsSync(path)) return [];
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const table = sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get('changes');
    if (!table) return [];
    return drizzle(sqlite, { schema: tables })
      .select()
      .from(tables.changes)
      .orderBy(asc(tables.changes.id))
      .all();
  } finally {
    sqlite.close();
  }
}
