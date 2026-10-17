// The history of edits the CLI records: every write command (set, unset,
// apply, init) records what it changed, a secret's value never; and
// `configure-env history`, which lists it.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  DEFAULT_STATE_PATH,
  LEGACY_UNDO_REASON,
  SECRET_PREVIEW,
  SECRET_UNDO_REASON,
  readChanges,
  stateSchemaVersion,
} from '@configure-env/core';
import { describe, expect, it } from 'vite-plus/test';
import { HISTORY_LIMIT } from './history.ts';
import { run, useProject, writeV1State } from './test-helpers.ts';

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
const json = (r: { out: string[] }) => JSON.parse(r.out.join('\n'));

/**
 * The database's bytes, as a hash, and how many its WAL holds: SQLite may
 * leave an empty WAL next to a database it opened read-only.
 */
const snapshot = async (state: string) => ({
  db: createHash('sha256')
    .update(await readFile(state))
    .digest('hex'),
  wal: (await readFile(`${state}-wal`).catch(() => Buffer.alloc(0))).length,
});

/** The schema version, read as a version-1 reader would: its columns only. */
function v1SchemaVersion(state: string): string | undefined {
  const sqlite = new Database(state, { readonly: true, fileMustExist: true });
  try {
    sqlite
      .prepare(
        'select id, actor, file, key, operation, before_fingerprint, after_fingerprint, before_preview, after_preview, at from changes',
      )
      .all();
    return (
      sqlite
        .prepare("select value from meta where key = 'schema_version'")
        .get() as { value: string } | undefined
    )?.value;
  } finally {
    sqlite.close();
  }
}
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

describe('configure-env history', () => {
  it('says so when nothing was recorded, and changes nothing', async () => {
    expect(await cli(['history'])).toEqual({
      code: 0,
      out: ['No changes recorded yet.'],
      err: [],
    });
    expect(json(await cli(['history', '--json']))).toEqual({
      command: 'history',
      ok: true,
      total: 0,
      changes: [],
    });
    await expect(readFile(path(DEFAULT_STATE_PATH))).rejects.toThrow();
  });

  it('lists the latest changes, newest first, a secret masked', async () => {
    await writeFile(path('app.env'), 'NAME=old\n');
    const token = fakeSecret('history');
    await cli(['set', '--ci', 'NAME=new', `TOKEN=${token}`]);
    await cli(['unset', '--ci', 'NAME']);
    const r = await cli(['history']);
    expect(r.code).toBe(0);
    expect(r.err).toEqual([]);
    const rows = r.out.map((line) => line.split(/\s{2,}/));
    expect(rows[0]).toEqual([
      'ID',
      'WHEN (UTC)',
      'BY',
      'CHANGE',
      'FILE',
      'KEY',
      'BEFORE',
      'AFTER',
    ]);
    expect(rows.slice(1).map((row) => [row[0], ...row.slice(2)])).toEqual([
      ['3', 'cli', 'unset', 'app.env', 'NAME', 'new', '-'],
      ['2', 'cli', 'set', 'app.env', 'TOKEN', '-', '••••'],
      ['1', 'cli', 'set', 'app.env', 'NAME', 'old', 'new'],
    ]);
    expect(rows[1]![1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r.out.join('\n')).not.toContain(token);

    const document = json(await cli(['history', '--json']));
    expect(document).toMatchObject({ command: 'history', ok: true, total: 3 });
    expect(document.changes[1]).toEqual({
      id: 2,
      at: expect.any(String),
      actor: 'cli',
      file: 'app.env',
      key: 'TOKEN',
      operation: 'set',
      before: null,
      after: '••••',
      restorable: false,
      undoBlocker: SECRET_UNDO_REASON,
      undoOf: null,
    });
    expect(document.changes[2]).toMatchObject({
      id: 1,
      before: 'old',
      after: 'new',
      restorable: true,
      undoOf: null,
    });
    expect(JSON.stringify(document)).not.toContain(token);
    expect(JSON.stringify(document)).not.toMatch(/fingerprint/i);
  });

  it(`shows the ${HISTORY_LIMIT} latest and how many there are`, async () => {
    await writeFile(path('app.env'), '');
    for (let i = 0; i <= HISTORY_LIMIT; i += 1)
      await cli(['set', '--ci', `PORT=${1000 + i}`]);
    const r = await cli(['history']);
    expect(r.out).toHaveLength(HISTORY_LIMIT + 2);
    expect(r.out.at(-1)).toBe(
      `The ${HISTORY_LIMIT} latest of ${HISTORY_LIMIT + 1} changes; undo one in the portal (configure-env serve).`,
    );
    const document = json(await cli(['history', '--json']));
    expect(document.total).toBe(HISTORY_LIMIT + 1);
    expect(document.changes).toHaveLength(HISTORY_LIMIT);
    expect(document.changes[0].id).toBe(HISTORY_LIMIT + 1);
  });

  it('names an undo and the schema writes', async () => {
    await rm(path('env.schema.json'));
    await cli(['init', '--ci']);
    const r = await cli(['history']);
    expect(r.out[1]!.split(/\s{2,}/).slice(2)).toEqual([
      'cli',
      'schema',
      'env.schema.json',
      '-',
      '-',
      '0 variables, 0 files',
    ]);
  });

  it('refuses --file and a history it cannot read', async () => {
    expect(await cli(['history', '--file', 'app.env'])).toMatchObject({
      code: 2,
      err: ['configure-env: history takes no --file'],
    });
    await mkdir(path('.configure-env'));
    await writeFile(
      path(DEFAULT_STATE_PATH),
      'not a database at all, long enough',
    );
    const r = await cli(['history']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: .configure-env/state.db: is not a valid state database',
    ]);
  });

  it("says a secret's change an older version recorded can't be undone as a secret's", async () => {
    await writeV1State(path(DEFAULT_STATE_PATH), [
      {
        actor: 'portal',
        file: 'app.env',
        key: 'TOKEN',
        operation: 'set',
        afterPreview: SECRET_PREVIEW,
        at: '2026-01-01T00:00:00.000Z',
      },
      {
        actor: 'cli',
        file: 'app.env',
        key: 'NAME',
        operation: 'set',
        afterPreview: 'plain',
        at: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const document = json(await cli(['history', '--json']));
    expect(document).toMatchObject({ ok: true, total: 2 });
    expect(document.changes).toEqual([
      {
        id: 2,
        at: '2026-01-02T00:00:00.000Z',
        actor: 'cli',
        file: 'app.env',
        key: 'NAME',
        operation: 'set',
        before: null,
        after: 'plain',
        restorable: false,
        undoBlocker: LEGACY_UNDO_REASON,
        undoOf: null,
      },
      {
        id: 1,
        at: '2026-01-01T00:00:00.000Z',
        actor: 'portal',
        file: 'app.env',
        key: 'TOKEN',
        operation: 'set',
        before: null,
        after: SECRET_PREVIEW,
        restorable: false,
        undoBlocker: SECRET_UNDO_REASON,
        undoOf: null,
      },
    ]);
  });

  it('reads a database an older version wrote without upgrading it', async () => {
    const state = path(DEFAULT_STATE_PATH);
    await writeV1State(state, [
      {
        actor: 'cli',
        file: 'app.env',
        key: 'NAME',
        operation: 'set',
        beforePreview: 'old',
        afterPreview: 'new',
        at: '2026-01-02T03:04:05.000Z',
      },
    ]);
    const before = await snapshot(state);
    const r = await cli(['history']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out[1]!.split(/\s{2,}/)).toEqual([
      '1',
      '2026-01-02 03:04',
      'cli',
      'set',
      'app.env',
      'NAME',
      'old',
      'new',
    ]);
    expect(json(await cli(['history', '--json'])).changes).toMatchObject([
      { id: 1, restorable: false, undoBlocker: LEGACY_UNDO_REASON },
    ]);
    expect(await snapshot(state)).toEqual(before);
    expect(v1SchemaVersion(state)).toBe('1');
  });

  it('refuses a database of a newer version, changing nothing', async () => {
    await writeFile(path('app.env'), '');
    await cli(['set', '--ci', 'PORT=1000']);
    const state = path(DEFAULT_STATE_PATH);
    const sqlite = new Database(state);
    sqlite
      .prepare("update meta set value = ? where key = 'schema_version'")
      .run(String(stateSchemaVersion() + 1));
    sqlite.close();
    const before = await snapshot(state);
    expect(await cli(['history'])).toEqual({
      code: 1,
      out: [],
      err: [
        `configure-env: .configure-env/state.db: has schema version ${stateSchemaVersion() + 1}, newer than this configure-env knows (${stateSchemaVersion()}); upgrade configure-env`,
      ],
    });
    expect(await snapshot(state)).toEqual(before);
  });

  it('prints its help', async () => {
    const r = await cli(['history', '--help']);
    expect(r.code).toBe(0);
    expect(r.out[0]).toContain('Usage: configure-env history [options]');
    expect(r.out[0]).toContain(`Lists the ${HISTORY_LIMIT} latest changes`);
  });
});
