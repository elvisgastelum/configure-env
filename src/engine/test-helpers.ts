// Shared by the engine tests: a schema exercising every policy, and a
// temporary project root.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { EnvSchema } from '../schema/definition.ts';
import { parseSchema } from '../schema/load.ts';

/** Parses a schema, failing the test when it is invalid. */
export function schemaOf(json: Record<string, unknown>): EnvSchema {
  const result = parseSchema({ version: 1, ...json });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.schema;
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
