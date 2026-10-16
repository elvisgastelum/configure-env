import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_STATE_PATH,
  LEGACY_UNDO_REASON,
  SECRET_PREVIEW,
  SECRET_UNDO_REASON,
  UNDECLARED_UNDO_REASON,
  readChanges,
  recordChanges,
  schemaFingerprint,
  stateSchemaVersion,
} from '@configure-env/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ApiServer,
  TOKEN,
  protectedEnv,
  protectedProject,
  removeProject,
  startServer,
  writeProject,
  writeV1State,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
let root: string;
let server: ApiServer;

const post = (path: string, body: object = {}) =>
  request(server.url).post(path).set('Authorization', bearer).send(body);
const get = (path: string) =>
  request(server.url).get(path).set('Authorization', bearer);
const envText = () => readFile(join(root, '.env'), 'utf8');
const schemaText = () => readFile(join(root, 'env.schema.json'), 'utf8');
const history = () => readChanges(join(root, DEFAULT_STATE_PATH));
const BASE = schemaFingerprint(protectedEnv);
// Built at run time: no secret-looking literal in the sources.
const fakeSecret = (tag: string) => ['sk', tag, 'z'.repeat(16)].join('-');

beforeEach(async () => {
  root = await protectedProject();
  server = await startServer(root);
});

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

/** Sets NAME through the API: the change the tests undo. */
async function setName(value: string, fingerprint = BASE) {
  const response = await post('/api/values/set', {
    file: '.env',
    fingerprint,
    values: { NAME: value },
  });
  expect(response.status).toBe(200);
  return response.body as { changes: number[]; fingerprint: string };
}

describe('GET /api/history', () => {
  it('is empty before any change', async () => {
    const response = await get('/api/history');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      changes: [],
      total: 0,
      page: 1,
      limit: 50,
    });
  });

  it('lists the changes newest first, never a fingerprint or a secret', async () => {
    const first = await setName('one');
    await post('/api/values/set', {
      file: '.env',
      fingerprint: first.fingerprint,
      values: { NAME: 'two' },
      generate: ['TOKEN'],
    });
    const response = await get('/api/history');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 3, page: 1, limit: 50 });
    expect(response.body.changes).toEqual([
      {
        id: 3,
        actor: 'portal',
        file: '.env',
        key: 'TOKEN',
        operation: 'set',
        at: expect.any(String),
        secret: true,
        beforePreview: null,
        afterPreview: '••••',
        beforeValue: null,
        afterValue: null,
        restorable: false,
        undoBlocker: SECRET_UNDO_REASON,
        undoOf: null,
      },
      expect.objectContaining({
        id: 2,
        key: 'NAME',
        secret: false,
        beforeValue: 'one',
        afterValue: 'two',
        restorable: true,
      }),
      expect.objectContaining({ id: 1, beforeValue: 'app', afterValue: 'one' }),
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/fingerprint/i);
    const token = /^TOKEN=(.+)$/m.exec(await envText())![1]!;
    expect(JSON.stringify(response.body)).not.toContain(token);
  });

  it('filters by file, key, actor and date, one page at a time', async () => {
    const statePath = join(root, DEFAULT_STATE_PATH);
    const set = (file: string, key: string) => ({
      file,
      key,
      operation: 'set' as const,
      spec: { type: 'string' as const, required: false, secret: false },
      after: 'x',
    });
    await recordChanges(
      statePath,
      'cli',
      [set('.env', 'A')],
      new Date('2026-01-01T10:00:00Z'),
    );
    await recordChanges(
      statePath,
      'portal',
      [set('.env', 'B'), set('config/app.env', 'A')],
      new Date('2026-01-02T10:00:00Z'),
    );
    const ids = async (query: string) =>
      (await get(`/api/history?${query}`)).body.changes.map(
        (change: { id: number }) => change.id,
      );
    expect(await ids('file=.env')).toEqual([2, 1]);
    expect(await ids('key=A')).toEqual([3, 1]);
    expect(await ids('actor=cli')).toEqual([1]);
    expect(await ids('from=2026-01-02')).toEqual([3, 2]);
    expect(await ids('to=2026-01-01')).toEqual([1]);
    expect(await ids('file=.env&key=B&actor=portal')).toEqual([2]);
    const paged = await get('/api/history?limit=2&page=2');
    expect(paged.body).toMatchObject({
      total: 3,
      page: 2,
      limit: 2,
      changes: [{ id: 1 }],
    });
  });

  it('refuses a filter that is not valid', async () => {
    for (const query of [
      'actor=someone',
      'from=yesterday',
      'limit=0',
      'page=x',
    ])
      expect((await get(`/api/history?${query}`)).status, query).toBe(400);
  });
});

describe('POST /api/history/:id/undo', () => {
  it('sets the previous value back, records the undo and answers the file now', async () => {
    const { changes } = await setName('new');
    expect(changes).toEqual([1]);
    const response = await post('/api/history/1/undo');
    expect(response.status).toBe(200);
    expect(await envText()).toBe(protectedEnv);
    expect(response.body).toMatchObject({
      undone: { id: 1, key: 'NAME', afterValue: 'new' },
      change: {
        id: 2,
        actor: 'portal',
        operation: 'set',
        beforeValue: 'new',
        afterValue: 'app',
        undoOf: 1,
      },
      file: { path: '.env', fingerprint: BASE },
      warnings: [],
    });
    expect(await history()).toHaveLength(2);
  });

  it('answers 409 with an explanation and the file now when it changed since', async () => {
    const { fingerprint } = await setName('new');
    await setName('newer', fingerprint);
    const response = await post('/api/history/1/undo');
    expect(response.status).toBe(409);
    const text = await envText();
    expect(text).toContain('NAME=newer');
    expect(response.body).toMatchObject({
      statusCode: 409,
      message:
        'NAME in .env no longer holds the value this change wrote, so it was not undone; it changed after this change was made',
      change: { id: 1 },
      file: { path: '.env', fingerprint: schemaFingerprint(text) },
    });
    expect(await history()).toHaveLength(2);
  });

  it("refuses a secret's change: its value is never stored", async () => {
    const secret = fakeSecret('undo');
    await writeFile(join(root, '.env'), `${protectedEnv}TOKEN=${secret}\n`);
    const unset = await post('/api/values/unset', {
      file: '.env',
      fingerprint: schemaFingerprint(await envText()),
      keys: ['TOKEN'],
    });
    expect(unset.status).toBe(200);
    const response = await post(`/api/history/${unset.body.changes[0]}/undo`);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      kind: 'not-restorable',
      message: SECRET_UNDO_REASON,
      errors: [{ message: SECRET_UNDO_REASON }],
      change: { key: 'TOKEN', secret: true, restorable: false },
    });
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(await envText()).toBe(protectedEnv);
  });

  it('writes the previous schema back, or answers 409 with the schema now', async () => {
    const before = await schemaText();
    const added = await post('/api/schema/variables', {
      fingerprint: schemaFingerprint(before),
      name: 'DEBUG',
      spec: { type: 'boolean' },
    });
    const id = added.body.change as number;
    const undone = await post(`/api/history/${id}/undo`);
    expect(undone.status).toBe(200);
    expect(await schemaText()).toBe(before);
    expect(undone.body).toMatchObject({
      undone: { id, operation: 'schema' },
      change: { operation: 'schema', undoOf: id, afterValue: before },
      schema: { valid: true, fingerprint: schemaFingerprint(before) },
    });
    // Undone already: what the change wrote is no longer there.
    const again = await post(`/api/history/${id}/undo`);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      message:
        'env.schema.json changed after this change was made, so it was not undone',
      schema: { fingerprint: schemaFingerprint(before) },
    });
  });

  it('answers 404 for no such change and 400 for no id', async () => {
    expect((await post('/api/history/7/undo')).status).toBe(404);
    expect((await post('/api/history/x/undo')).status).toBe(400);
  });
});

describe('a history an older version recorded', () => {
  const statePath = () => join(root, DEFAULT_STATE_PATH);
  /** The schema version, read as a version-1 reader would: its columns only. */
  const schemaVersion = () => {
    const sqlite = new DatabaseSync(statePath(), { readOnly: true });
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
  };
  /** The database's bytes, as a hash, and how many its WAL holds. */
  const snapshot = async () => ({
    db: createHash('sha256')
      .update(await readFile(statePath()))
      .digest('hex'),
    wal: (await readFile(`${statePath()}-wal`).catch(() => Buffer.alloc(0)))
      .length,
  });
  const legacyRows = () =>
    writeV1State(statePath(), [
      {
        actor: 'portal',
        file: '.env',
        key: 'TOKEN',
        operation: 'set',
        afterPreview: SECRET_PREVIEW,
        at: '2026-01-01T00:00:00.000Z',
      },
      {
        actor: 'cli',
        file: '.env',
        key: 'NAME',
        operation: 'set',
        beforePreview: 'one',
        afterPreview: 'two',
        at: '2026-01-02T00:00:00.000Z',
      },
    ]);

  it("shows a secret's change as a secret's, which can't be undone", async () => {
    await legacyRows();
    const response = await get('/api/history');
    expect(response.status).toBe(200);
    expect(response.body.changes).toMatchObject([
      {
        id: 2,
        key: 'NAME',
        secret: false,
        restorable: false,
        beforeValue: null,
        afterValue: null,
        undoBlocker: LEGACY_UNDO_REASON,
      },
      {
        id: 1,
        key: 'TOKEN',
        secret: true,
        restorable: false,
        afterPreview: SECRET_PREVIEW,
        undoBlocker: SECRET_UNDO_REASON,
      },
    ]);
    expect(schemaVersion()).toBe('1');
    const undo = await post('/api/history/1/undo');
    expect(undo.status).toBe(422);
    expect(undo.body).toMatchObject({
      kind: 'not-restorable',
      message: SECRET_UNDO_REASON,
      errors: [{ message: SECRET_UNDO_REASON }],
      change: { id: 1, key: 'TOKEN', secret: true, restorable: false },
    });
    // An undo writes the database: upgraded first, as by any write.
    expect(schemaVersion()).toBe(String(stateSchemaVersion()));
  });

  it('reads it without upgrading it, so the older version still reads it', async () => {
    await legacyRows();
    const before = await snapshot();
    const response = await get('/api/history?key=NAME');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, changes: [{ id: 2 }] });
    expect(await snapshot()).toEqual(before);
    expect(schemaVersion()).toBe('1');
  });

  it('refuses a database of a newer version, changing nothing', async () => {
    await setName('one');
    const newer = stateSchemaVersion() + 1;
    const sqlite = new DatabaseSync(statePath());
    sqlite
      .prepare("update meta set value = ? where key = 'schema_version'")
      .run(String(newer));
    sqlite.close();
    const before = await snapshot();
    const response = await get('/api/history');
    expect(response.status).toBe(503);
    expect(response.body.message).toBe(
      `${statePath()}: has schema version ${newer}, newer than this configure-env knows (${stateSchemaVersion()}); upgrade configure-env`,
    );
    expect(await snapshot()).toEqual(before);
  });
});

describe('the history the API records keeps no secret value', () => {
  const SCHEMA = {
    version: 1,
    variables: {
      HOST: { type: 'string' },
      API_KEY: { type: 'string', secret: true },
    },
    files: [
      { path: '.env', policy: 'merge', variables: '*' },
      { path: '.env.local', policy: 'merge', variables: ['HOST'] },
    ],
  };

  /** The database's bytes, with its WAL and shared-memory files. */
  async function stateBytes(): Promise<string> {
    const base = join(root, DEFAULT_STATE_PATH);
    const parts = await Promise.all(
      [base, `${base}-wal`, `${base}-shm`].map((file) =>
        readFile(file).catch(() => Buffer.alloc(0)),
      ),
    );
    return Buffer.concat(parts).toString('latin1');
  }

  it('when the file does not list the secret, or the schema does not declare a key', async () => {
    const secret = fakeSecret('local');
    const stray = fakeSecret('stray');
    await server.close();
    await removeProject(root);
    root = await writeProject({
      'env.schema.json': JSON.stringify(SCHEMA),
      '.env.local': `HOST=a\nAPI_KEY=${secret}\n`,
      '.env': `HOST=a\nSTRAY=${stray}\n`,
    });
    server = await startServer(root);

    const unset = await post('/api/values/unset', {
      file: '.env.local',
      fingerprint: schemaFingerprint(
        await readFile(join(root, '.env.local'), 'utf8'),
      ),
      keys: ['API_KEY'],
    });
    expect(unset.status).toBe(200);
    const plan = await post('/api/plan', { files: ['.env'], prune: true });
    const applied = await post('/api/apply', {
      files: ['.env'],
      prune: true,
      fingerprint: plan.body.fingerprint,
    });
    expect(applied.status).toBe(200);

    const listed = await get('/api/history');
    const printed = JSON.stringify(listed.body);
    const bytes = await stateBytes();
    for (const value of [secret, stray]) {
      expect(printed).not.toContain(value);
      expect(bytes).not.toContain(value);
    }
    expect(listed.body.changes).toMatchObject([
      // apply adds the secret .env lists, empty: masked all the same.
      { key: 'API_KEY', file: '.env', afterPreview: '••••', afterValue: null },
      {
        key: 'STRAY',
        beforePreview: '••••',
        beforeValue: null,
        restorable: false,
        undoBlocker: UNDECLARED_UNDO_REASON,
      },
      {
        key: 'API_KEY',
        file: '.env.local',
        secret: true,
        beforePreview: '••••',
        beforeValue: null,
        restorable: false,
        undoBlocker: SECRET_UNDO_REASON,
      },
    ]);
  });
});
