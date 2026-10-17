// `apply` in a terminal with --generate: what the picked files that exist
// and the prompted values do to the run, as before it ran over the API.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
  STATE,
  readState,
  run,
  scriptedPrompts,
  useProject,
} from './test-helpers.ts';

const HELD = 'held-secret-value-0123456789';
const KEPT = 'kept-protected-value-123';

const SCHEMA = {
  version: 1,
  variables: {
    SECRET: { type: 'string', secret: true },
    KEY: { type: 'string', secret: true, protected: true },
    NAME: { type: 'string' },
    GEN: { type: 'string', secret: true, conflictsWith: ['B'] },
    B: { type: 'string' },
  },
  files: [
    { path: '.env', policy: 'merge', variables: ['SECRET', 'NAME'] },
    {
      path: 'local.env',
      policy: 'create-only',
      variables: ['SECRET', 'KEY'],
    },
    { path: 'pair.env', policy: 'merge', variables: ['GEN', 'B'] },
  ],
};

const dirs = useProject(SCHEMA);
const path = (name: string) => join(dirs.root, name);
const read = (name: string) =>
  readFile(path(name), 'utf8').catch(() => undefined);
const exists = (name: string) =>
  stat(path(name)).then(
    () => true,
    () => false,
  );

describe('apply --generate in a terminal', () => {
  it('reuses the value a picked existing create-only file holds, recording none of its fingerprints', async () => {
    await writeFile(path('local.env'), `SECRET=${HELD}\nKEY=${KEPT}\n`);
    const { prompts, logs } = scriptedPrompts({
      'Which files': ['.env', 'local.env'],
      NAME: 'app',
    });
    const r = await run(['apply', '--generate', 'SECRET'], {
      cwd: dirs.root,
      isTTY: true,
      prompts,
    });
    expect(r).toMatchObject({ code: 0, out: [], err: [] });
    expect(logs).toEqual([
      'intro: configure-env · env.schema.json',
      'info: local.env: exists; create-only files are never overwritten',
      `note: Plan: .env: create (SECRET=••••${HELD.slice(-2)}, NAME=app)`,
      'spinner: Writing',
      'spinner: Written',
      'outro: .env: created',
    ]);
    expect(await read('.env')).toBe(`SECRET=${HELD}\nNAME=app\n`);
    expect(await read('local.env')).toBe(`SECRET=${HELD}\nKEY=${KEPT}\n`);
    // Only .env was planned: the existing local.env's protected KEY is
    // not recorded.
    const { fingerprints } = await readState(path(STATE));
    expect(fingerprints).toEqual({});
  });

  it('leaves a prompted value that conflicts with a generated key to the rules: exit 1, nothing written', async () => {
    const { prompts, logs } = scriptedPrompts({
      'Which files': ['pair.env'],
      B: 'b',
    });
    const r = await run(['apply', '--generate', 'GEN'], {
      cwd: dirs.root,
      isTTY: true,
      prompts,
    });
    expect(r).toMatchObject({ code: 1, out: [], err: [] });
    expect(logs).toEqual([
      'intro: configure-env · env.schema.json',
      'error: GEN, B: set only one of them',
      'outro: Nothing was written.',
    ]);
    expect(await exists('pair.env')).toBe(false);
    expect(await exists(STATE)).toBe(false);
  });
});
