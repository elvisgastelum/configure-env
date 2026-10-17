// Shared by the engine tests: a schema exercising every policy, and a
// temporary project root.

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach } from 'vite-plus/test';
import type { EnvSchema } from '../schema/definition.ts';
import { parseSchema } from '../schema/load.ts';
import { SALT_BYTES, stateMigrations } from './state.ts';

/** Parses a schema, failing the test when it is invalid. */
export function schemaOf(json: Record<string, unknown>): EnvSchema {
  const result = parseSchema({ version: 1, ...json });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.schema;
}

/** A row of the history as schema version 1 (PV-21) wrote it. */
export interface V1ChangeRow {
  actor: 'cli' | 'portal';
  file: string;
  key: string;
  operation: string;
  beforePreview?: string | null;
  afterPreview?: string | null;
  at: string;
}

/**
 * Writes a state database at `path` as a version with only the first
 * migration wrote it (schema version 1), holding `rows` in its history.
 */
export async function writeV1State(
  path: string,
  rows: readonly V1ChangeRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma('journal_mode = WAL');
    for (const statement of stateMigrations()[0]!.sql)
      if (statement.trim()) sqlite.exec(statement);
    const meta = sqlite.prepare('insert into meta (key, value) values (?, ?)');
    meta.run('schema_version', '1');
    meta.run('salt', randomBytes(SALT_BYTES).toString('base64'));
    const insert = sqlite.prepare(
      'insert into changes (actor, file, key, operation, before_fingerprint, after_fingerprint, before_preview, after_preview, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      const before = row.beforePreview ?? null;
      const after = row.afterPreview ?? null;
      insert.run(
        row.actor,
        row.file,
        row.key,
        row.operation,
        before === null ? null : 'a'.repeat(64),
        after === null ? null : 'b'.repeat(64),
        before,
        after,
        row.at,
      );
    }
  } finally {
    sqlite.close();
  }
}

/** generate, merge and create-only files over four variables. */
export const testSchema = () =>
  schemaOf({
    variables: {
      HOST: {
        type: 'host',
        group: 'Server',
        required: true,
        default: '127.0.0.1',
        comment: 'Where to listen.',
      },
      PORT: { type: 'port', group: 'Server', default: 8080 },
      TOKEN: {
        type: 'string',
        group: 'Auth',
        secret: true,
        minLength: 8,
        comment: 'API token.\n\nKeep it safe.',
      },
      DEBUG: { type: 'boolean', default: false },
    },
    files: [
      {
        path: 'gen/app.env',
        policy: 'generate',
        header: 'Generated.\n\nDo not edit.',
        variables: '*',
        values: { TOKEN: '<token>' },
      },
      {
        path: 'merge.env',
        policy: 'merge',
        variables: ['HOST', 'PORT', 'DEBUG'],
        comments: { PORT: 'The port.' },
      },
      {
        path: 'local.env',
        policy: 'create-only',
        mode: '600',
        variables: ['HOST', 'TOKEN'],
      },
    ],
  });

/**
 * A secret-manager-like setup: a key or a file for it, never both, and a
 * previous key that must differ from the current one.
 */
export const rulesSchema = () =>
  schemaOf({
    variables: {
      KEY: {
        type: 'string',
        secret: true,
        comment: 'The master key.',
        requiredUnless: 'KEY_FILE',
        conflictsWith: 'KEY_FILE',
      },
      KEY_FILE: { type: 'string' },
      OLD_KEY: {
        type: 'string',
        secret: true,
        requiredUnless: ['OLD_KEY_FILE', 'KEY_FILE'],
        distinctFrom: 'KEY',
      },
      OLD_KEY_FILE: { type: 'string' },
    },
    files: [
      { path: 'app.env', policy: 'merge', variables: '*' },
      { path: 'app.env.example', policy: 'merge', variables: '*' },
      { path: 'key.env', policy: 'merge', variables: ['KEY', 'OLD_KEY'] },
    ],
  });

export const GENERATED = [
  '# Generated.',
  '#',
  '# Do not edit.',
  '',
  '# Where to listen.',
  'HOST=127.0.0.1',
  'PORT=8080',
  '',
  '# API token.',
  '#',
  '# Keep it safe.',
  'TOKEN=<token>',
  '',
  'DEBUG=false',
  '',
].join('\n');

export const MERGED = [
  '# Where to listen.',
  'HOST=127.0.0.1',
  '',
  '# The port.',
  'PORT=8080',
  '',
  'DEBUG=false',
  '',
].join('\n');

/** A fresh temporary directory per test, as `dirs.root`; more on request. */
export function useTempRoot() {
  const dirs = { root: '', extra: [] as string[] };
  beforeEach(async () => {
    dirs.root = await mkdtemp(join(tmpdir(), 'configure-env-engine-'));
  });
  afterEach(async () => {
    for (const dir of [dirs.root, ...dirs.extra])
      await rm(dir, { recursive: true, force: true });
    dirs.extra = [];
  });
  return {
    dirs,
    async another() {
      const dir = await mkdtemp(join(tmpdir(), 'configure-env-outside-'));
      dirs.extra.push(dir);
      return dir;
    },
  };
}
