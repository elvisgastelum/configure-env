// Shared by the e2e tests: a fixture project on disk and a running server
// over it, on an ephemeral port.

import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SALT_BYTES, stateMigrations } from '@configure-env/core';
import { type ApiServer, createServer } from './server.ts';

export const TOKEN = 'test-token-0123456789abcdefghijklmnop';

/** The fixture schema: a merge file with secrets, a template and a generated file. */
export const fixtureSchema = {
  version: 1,
  variables: {
    API_URL: {
      type: 'url',
      required: true,
      description: 'Where the API lives.',
    },
    PORT: { type: 'port', default: 3000 },
    DB_PASSWORD: {
      type: 'string',
      secret: true,
      required: true,
      minLength: 12,
    },
    API_KEY: { type: 'string', secret: true },
    LOG_LEVEL: { type: 'enum', values: ['debug', 'info'], default: 'info' },
  },
  files: [
    { path: '.env', policy: 'merge', mode: '600', variables: '*' },
    { path: '.env.example', policy: 'generate', variables: '*' },
    {
      path: 'config/app.env',
      policy: 'generate',
      variables: ['PORT', 'LOG_LEVEL'],
    },
  ],
};

export const DB_PASSWORD = 'correct-horse-battery-staple';

/** `.env` as the fixture holds it: an invalid URL, a secret, an unknown key and a broken line. */
export const fixtureEnv = [
  'API_URL=not-a-url',
  'PORT=8080',
  `DB_PASSWORD=${DB_PASSWORD}`,
  'LOG_LEVEL=debug',
  'EXTRA=1',
  'this is not an entry',
  '',
].join('\n');

/** Writes `files` (path to content) into a new temporary directory; returns its real path. */
export async function writeProject(
  files: Record<string, string>,
): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'configure-env-api-')),
  );
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** The fixture project: `.env` is 644 though the schema wants 600. */
export async function fixtureProject(): Promise<string> {
  const root = await writeProject({
    'env.schema.json': JSON.stringify(fixtureSchema, null, 2),
    '.env': fixtureEnv,
  });
  await chmod(join(root, '.env'), 0o644);
  return root;
}

/** Starts a server over `root` on an ephemeral loopback port. */
export function startServer(root: string, schemaPath = 'env.schema.json') {
  return createServer({ root, schemaPath, port: 0, token: TOKEN });
}

export const removeProject = (root: string) =>
  rm(root, { recursive: true, force: true });

export type { ApiServer };

/** A schema with a protected secret, for the write endpoints. */
export const protectedSchema = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 3000 },
    NAME: { type: 'string' },
    SESSION_KEY: {
      type: 'string',
      secret: true,
      protected: { reason: 'signs every session' },
    },
    TOKEN: { type: 'string', secret: true, encoding: 'hex', bytes: 16 },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*' },
    { path: 'config/app.env', policy: 'generate', variables: ['PORT'] },
  ],
};

export const SESSION_KEY = 'session-key-0123456789';

/** `.env` of the protected project. */
export const protectedEnv = [
  '# local overrides',
  'PORT=8080',
  'NAME=app',
  `SESSION_KEY=${SESSION_KEY}`,
  '',
].join('\n');

/** A project whose schema protects SESSION_KEY. */
export const protectedProject = () =>
  writeProject({
    'env.schema.json': JSON.stringify(protectedSchema, null, 2),
    '.env': protectedEnv,
  });

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
  // node:sqlite: the API does not depend on better-sqlite3 itself.
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec('PRAGMA journal_mode = WAL');
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
