// The history of edits the CLI records: every write command (set, unset,
// apply, init) records what it changed, a secret's value never.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_STATE_PATH, readChanges } from '@configure-env/core';
import { describe, expect, it } from 'vitest';
import { run, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 8080 },
    NAME: { type: 'string' },
    TOKEN: { type: 'string', secret: true, minLength: 8 },
  },
  files: [{ path: 'app.env', policy: 'merge', variables: '*' }],
};

const dirs = useProject(SCHEMA);
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const path = (name: string) => join(dirs.root, name);
const history = () => readChanges(path(DEFAULT_STATE_PATH));
// Built at run time: no secret-looking literal in the sources.
const fakeSecret = (tag: string) => ['tok', tag, 'y'.repeat(12)].join('-');

/** Every row of the history as raw text: what the database holds. */
function dump(): string {
  const sqlite = new Database(path(DEFAULT_STATE_PATH), { readonly: true });
  try {
    return JSON.stringify(sqlite.prepare('select * from changes').all());
  } finally {
    sqlite.close();
  }
}

describe('the history the CLI records', () => {
  it('set records each changed key, keeping a plain value and never a secret', async () => {
    await writeFile(path('app.env'), 'NAME=old\n');
    const token = fakeSecret('set');
    const r = await cli([
      'set',
      '--ci',
      'NAME=new',
      'PORT=8080',
      `TOKEN=${token}`,
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'NAME: updated (new)',
        'PORT: added (8080)',
        'TOKEN: added (••••yy)',
      ],
      err: [],
    });
    expect(await history()).toMatchObject([
      {
        actor: 'cli',
        file: 'app.env',
        key: 'NAME',
        operation: 'set',
        beforeValue: 'old',
        afterValue: 'new',
        restorable: true,
      },
      { key: 'PORT', beforeValue: null, afterValue: '8080', restorable: true },
      {
        key: 'TOKEN',
        beforeValue: null,
        afterValue: null,
        afterPreview: '••••',
        restorable: false,
      },
    ]);
    expect(dump()).not.toContain(token);
  });

  it('set records a piped value as a secret, whatever its spec', async () => {
    await writeFile(path('app.env'), '');
    const r = await cli(['set', '--ci', '--stdin', 'NAME'], {
      stdin: 'piped-value\n',
    });
    expect(r.code).toBe(0);
    expect(await history()).toMatchObject([
      {
        key: 'NAME',
        afterPreview: '••••',
        afterValue: null,
        restorable: false,
      },
    ]);
    expect(dump()).not.toContain('piped-value');
  });

  it('set records nothing for a value it left as it was', async () => {
    await writeFile(path('app.env'), 'NAME=same\n');
    expect((await cli(['set', '--ci', 'NAME=same'])).code).toBe(0);
    expect(await history()).toEqual([]);
  });

  it('unset records each removed key', async () => {
    await writeFile(path('app.env'), 'NAME=app\nPORT=1\n');
    const r = await cli(['unset', '--ci', 'NAME', 'MISSING']);
    expect(r).toMatchObject({
      code: 0,
      out: ['NAME: removed', 'MISSING: absent'],
      err: [],
    });
    expect(await history()).toMatchObject([
      {
        actor: 'cli',
        key: 'NAME',
        operation: 'unset',
        beforeValue: 'app',
        afterFingerprint: null,
        restorable: true,
      },
    ]);
  });

  it('apply records the keys it changed in the files it wrote', async () => {
    const token = fakeSecret('apply');
    const r = await cli(['apply', '--ci', '--set', `TOKEN=${token}`]);
    expect(r.code).toBe(0);
    const rows = await history();
    expect(rows.map((row) => [row.actor, row.file, row.key])).toEqual([
      ['cli', 'app.env', 'PORT'],
      ['cli', 'app.env', 'NAME'],
      ['cli', 'app.env', 'TOKEN'],
    ]);
    expect(rows[0]).toMatchObject({ afterValue: '8080', restorable: true });
    expect(rows[1]).toMatchObject({ afterValue: '', restorable: true });
    expect(rows[2]).toMatchObject({ afterValue: null, restorable: false });
    expect(dump()).not.toContain(token);
    // Nothing left to write: nothing more recorded.
    expect((await cli(['apply', '--ci'])).code).toBe(0);
    expect(await history()).toHaveLength(3);
  });

  it('a history it cannot write is a warning; the edit stands', async () => {
    await writeFile(path('app.env'), 'NAME=old\n');
    // A directory where the database should be: it cannot be opened.
    await mkdir(path(DEFAULT_STATE_PATH), { recursive: true });
    const r = await cli(['set', '--ci', 'NAME=new']);
    expect(r.code).toBe(0);
    expect(r.out).toEqual(['NAME: updated (new)']);
    expect(r.err).toEqual([
      'configure-env: warning: the history was not recorded: .configure-env/state.db: is not a regular file',
    ]);
  });
});

describe('the history init records', () => {
  it('records the schema it writes, and the one --force replaces', async () => {
    await rm(path('env.schema.json'));
    await writeFile(path('.env.example'), 'PORT=8080\n');
    const first = await cli(['init', '--ci']);
    expect(first.code).toBe(0);
    const written = await readFile(path('env.schema.json'), 'utf8');
    await writeFile(path('.env.example'), 'PORT=8080\nNAME=app\n');
    const forced = await cli(['init', '--ci', '--force']);
    expect(forced).toMatchObject({ code: 0, err: [] });
    expect(await history()).toMatchObject([
      {
        actor: 'cli',
        file: 'env.schema.json',
        key: '',
        operation: 'schema',
        beforeValue: null,
        afterValue: written,
        restorable: false,
      },
      {
        operation: 'schema',
        beforeValue: written,
        afterValue: await readFile(path('env.schema.json'), 'utf8'),
        afterPreview: '2 variables, 1 file',
        restorable: true,
      },
    ]);
  });
});
