// The tables of the state database (.configure-env/state.db). drizzle-kit
// generates the migrations in ../../drizzle from this file
// (`pnpm --filter @configure-env/core db:generate`); a test checks that the
// migrated tables match it. No column ever holds a secret's value: only
// salted HMACs and masked previews. The history keeps the values of
// variables that are not secret, and the schema's text, so a change to them
// can be undone.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/**
 * Key/value settings of the database: `schema_version` (how many migrations
 * it holds) and `salt` (the base64 HMAC salt of its fingerprints).
 */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** The fingerprint of each protected value, by schema file path and key. */
export const protectedFingerprints = sqliteTable(
  'protected_fingerprints',
  {
    file: text('file').notNull(),
    key: text('key').notNull(),
    hmac: text('hmac').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.file, table.key] })],
);

/**
 * The history of edits made by the CLI or the portal: who, which key of
 * which file, how, and fingerprints and masked previews of the value before
 * and after. A change to a variable that is not secret also keeps the values
 * (`before_value`, `after_value`), and a change to the schema (operation
 * `schema`, key empty) its text, so it is `restorable`. A value is never
 * kept for a secret, nor for a key the schema does not declare, and the
 * creation of the schema is not undone: `not_kept` says which, so the change
 * says why it cannot be undone. `undo_of` names the change an undo reverted. `operation` is not constrained in SQL, so the history can
 * name new operations without rebuilding the table.
 */
export const changes = sqliteTable(
  'changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actor: text('actor', { enum: ['cli', 'portal'] }).notNull(),
    file: text('file').notNull(),
    key: text('key').notNull(),
    operation: text('operation', {
      enum: ['set', 'unset', 'replace', 'schema'],
    }).notNull(),
    beforeFingerprint: text('before_fingerprint'),
    afterFingerprint: text('after_fingerprint'),
    beforePreview: text('before_preview'),
    afterPreview: text('after_preview'),
    at: text('at').notNull(),
    beforeValue: text('before_value'),
    afterValue: text('after_value'),
    restorable: integer('restorable', { mode: 'boolean' })
      .notNull()
      .default(false),
    undoOf: integer('undo_of'),
    notKept: text('not_kept', {
      enum: ['secret', 'undeclared', 'schema-created'],
    }),
  },
  (table) => [
    check('changes_actor', sql`${table.actor} in ('cli', 'portal')`),
    index('changes_file_key').on(table.file, table.key),
    index('changes_at').on(table.at),
  ],
);
