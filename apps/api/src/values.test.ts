import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_STATE_PATH,
  readChanges,
  schemaFingerprint,
} from '@configure-env/core';
import request from 'supertest';
import { createServer } from './server.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  type ApiServer,
  SESSION_KEY,
  TOKEN,
  protectedEnv,
  protectedProject,
  removeProject,
  startServer,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
let root: string;
let server: ApiServer;

const post = (path: string, body: object) =>
  request(server.url).post(path).set('Authorization', bearer).send(body);
const envText = () => readFile(join(root, '.env'), 'utf8');
const history = () => readChanges(join(root, DEFAULT_STATE_PATH));
const BASE = schemaFingerprint(protectedEnv);

beforeEach(async () => {
  root = await protectedProject();
  server = await startServer(root);
});

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

describe('POST /api/values/set', () => {
  it('sets values in place, returns the new fingerprint and records them', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { PORT: '9090', NAME: 'app' },
    });
    expect(response.status).toBe(200);
    const text = await envText();
    expect(text).toBe(protectedEnv.replace('PORT=8080', 'PORT=9090'));
    expect(response.body).toEqual({
      file: '.env',
      fingerprint: schemaFingerprint(text),
      keys: [
        { key: 'PORT', status: 'updated', value: '9090' },
        { key: 'NAME', status: 'unchanged', value: 'app' },
      ],
      replaced: [],
      generated: [],
      changes: [1],
      warnings: [],
    });
    expect(await history()).toEqual([
      expect.objectContaining({
        id: 1,
        actor: 'portal',
        file: '.env',
        key: 'PORT',
        operation: 'set',
        beforePreview: '8080',
        afterPreview: '9090',
        beforeValue: '8080',
        afterValue: '9090',
        restorable: true,
      }),
    ]);
  });

  it('refuses a value that breaks its rules, writing nothing', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { PORT: 'not-a-port' },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      kind: 'invalid',
      errors: [{ message: expect.stringMatching(/^PORT: /) }],
    });
    expect(await envText()).toBe(protectedEnv);
    expect(await history()).toEqual([]);
  });

  it('refuses a key the file does not list', async () => {
    const response = await post('/api/values/set', {
      file: 'config/app.env',
      fingerprint: null,
      values: { NAME: 'x' },
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { key: 'NAME', message: "is not one of config/app.env's variables" },
    ]);
  });

  it.each([
    ['a bad key', { values: { 'bad-key': 'x' } }],
    ['nothing to set', { values: {} }],
    ['no fingerprint', { fingerprint: undefined, values: { PORT: '1' } }],
    ['an unknown field', { values: { PORT: '1' }, extra: true }],
  ])('rejects a body with %s', async (_name, body) => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      ...body,
    });
    expect(response.status).toBe(400);
  });

  it('answers 404 for a file the schema does not manage', async () => {
    const response = await post('/api/values/set', {
      file: 'other.env',
      fingerprint: null,
      values: { PORT: '1' },
    });
    expect(response.status).toBe(404);
  });

  it('answers 409 with the current file when it changed on disk', async () => {
    const edited = `${protectedEnv}EXTRA=1\n`;
    await writeFile(join(root, '.env'), edited);
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { PORT: '9090' },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      file: {
        path: '.env',
        exists: true,
        fingerprint: schemaFingerprint(edited),
      },
    });
    expect(await envText()).toBe(edited);
  });

  it('creates a file based on its absence', async () => {
    const response = await post('/api/values/set', {
      file: 'config/app.env',
      fingerprint: null,
      values: { PORT: '4000' },
    });
    expect(response.status).toBe(200);
    expect(await readFile(join(root, 'config/app.env'), 'utf8')).toContain(
      'PORT=4000\n',
    );
  });

  it('answers 409 when a file it was told is absent exists', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: null,
      values: { PORT: '1' },
    });
    expect(response.status).toBe(409);
  });

  it('generates a secret without returning it, and records it masked', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      generate: ['TOKEN'],
    });
    expect(response.status).toBe(200);
    const token = /^TOKEN=([0-9a-f]+)$/m.exec(await envText())?.[1];
    expect(token).toHaveLength(32);
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(response.body).toMatchObject({
      generated: ['TOKEN'],
      keys: [{ key: 'TOKEN', status: 'added' }],
    });
    const [row] = await history();
    expect(row).toMatchObject({
      key: 'TOKEN',
      afterPreview: '••••',
      afterValue: null,
      restorable: false,
    });
    expect(response.body.changes).toEqual([row!.id]);
    expect(JSON.stringify(await history())).not.toContain(token);
  });

  it('refuses to generate a variable that is not a secret string', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      generate: ['NAME'],
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { key: 'NAME', message: expect.stringMatching(/secret string/) },
    ]);
  });

  it('refuses a key given as a value and to generate', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { TOKEN: 'aa' },
      generate: ['TOKEN'],
    });
    expect(response.status).toBe(400);
  });

  it('refuses to change a protected value, naming its reason', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { SESSION_KEY: 'another-session-key-000' },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      kind: 'protected',
      errors: [
        {
          key: 'SESSION_KEY',
          reason: 'signs every session',
          message: expect.stringMatching(/is protected/),
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(SESSION_KEY);
    expect(await envText()).toBe(protectedEnv);
  });

  it('replaces a protected value when asked by key', async () => {
    const response = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { SESSION_KEY: 'another-session-key-000' },
      replaceProtected: ['SESSION_KEY'],
    });
    expect(response.status).toBe(200);
    expect(response.body.replaced).toEqual(['SESSION_KEY']);
    expect(await envText()).toContain('SESSION_KEY=another-session-key-000');
    const rows = await history();
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'SESSION_KEY',
        operation: 'replace',
        beforePreview: '••••',
        afterPreview: '••••',
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(SESSION_KEY);
  });
});

describe('POST /api/values/set, as the CLI sends it', () => {
  const cli = (path: string, body: object) =>
    post(path, body).set('X-Configure-Env-Client', 'cli');

  it('records the actor cli for a request from the CLI, portal otherwise', async () => {
    const first = await cli('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { PORT: '9090' },
    });
    expect(first.status).toBe(200);
    const second = await post('/api/values/set', {
      file: '.env',
      fingerprint: first.body.fingerprint,
      values: { PORT: '9091' },
    });
    expect(second.status).toBe(200);
    const unset = await cli('/api/values/unset', {
      file: '.env',
      fingerprint: second.body.fingerprint,
      keys: ['NAME'],
    });
    expect(unset.status).toBe(200);
    expect((await history()).map((change) => change.actor)).toEqual([
      'cli',
      'portal',
      'cli',
    ]);
  });

  it('sets a key the file does not list with allowUnknown, as a plain string', async () => {
    const refused = await cli('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { EXTRA: 'one two' },
    });
    expect(refused.status).toBe(422);
    const response = await cli('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { EXTRA: 'one two' },
      allowUnknown: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.keys).toEqual([
      { key: 'EXTRA', status: 'added', value: 'one two' },
    ]);
    expect(await envText()).toBe(`${protectedEnv}EXTRA="one two"\n`);
  });

  it('keeps a value the file holds with keepExisting, generating only a missing one', async () => {
    await writeFile(
      join(root, '.env'),
      `${protectedEnv}TOKEN=${'ab'.repeat(16)}\n`,
    );
    const kept = await cli('/api/values/set', {
      file: '.env',
      fingerprint: schemaFingerprint(await envText()),
      generate: ['TOKEN'],
      keepExisting: true,
    });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({
      keys: [{ key: 'TOKEN', status: 'unchanged', value: '••••ab' }],
      generated: [],
      changes: [],
    });
    expect(await envText()).toContain(`TOKEN=${'ab'.repeat(16)}`);
  });

  it('masks a masked key in the answer and never keeps its value in the history', async () => {
    const response = await cli('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { NAME: 'piped-in-value' },
      masked: ['NAME'],
    });
    expect(response.status).toBe(200);
    expect(response.body.keys).toEqual([
      { key: 'NAME', status: 'updated', value: '••••ue' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('piped-in-value');
    expect(JSON.stringify(await history())).not.toContain('piped-in-value');
  });
});

describe('a value write whose state write fails', () => {
  it('names the state failure apart from the warnings', async () => {
    await server.close();
    server = await createServer({
      root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
      writeState: async () => {
        throw new Error('disk full');
      },
    });
    const written = await post('/api/values/set', {
      file: '.env',
      fingerprint: BASE,
      values: { PORT: '9090' },
    });
    expect(written.status).toBe(200);
    expect(written.body.stateError).toEqual([
      `${DEFAULT_STATE_PATH}: not written: disk full`,
      '.env was written; its protected values are not recorded',
    ]);
    expect(written.body.warnings).toEqual(written.body.stateError);
  });
});

describe('POST /api/values/unset', () => {
  it('removes keys and records them', async () => {
    const response = await post('/api/values/unset', {
      file: '.env',
      fingerprint: BASE,
      keys: ['NAME', 'TOKEN'],
    });
    expect(response.status).toBe(200);
    const text = await envText();
    expect(text).toBe(protectedEnv.replace('NAME=app\n', ''));
    expect(response.body).toMatchObject({
      fingerprint: schemaFingerprint(text),
      keys: [
        { key: 'NAME', status: 'removed' },
        { key: 'TOKEN', status: 'absent' },
      ],
      changes: [1],
    });
    expect(await history()).toEqual([
      expect.objectContaining({
        id: 1,
        key: 'NAME',
        operation: 'unset',
        beforePreview: 'app',
        afterPreview: null,
        afterFingerprint: null,
        beforeValue: 'app',
        restorable: true,
      }),
    ]);
  });

  it('refuses to remove a protected value', async () => {
    const response = await post('/api/values/unset', {
      file: '.env',
      fingerprint: BASE,
      keys: ['SESSION_KEY'],
    });
    expect(response.status).toBe(422);
    expect(response.body.kind).toBe('protected');
    expect(await envText()).toBe(protectedEnv);
  });

  it('answers 409 on a stale fingerprint', async () => {
    const response = await post('/api/values/unset', {
      file: '.env',
      fingerprint: schemaFingerprint('something else'),
      keys: ['NAME'],
    });
    expect(response.status).toBe(409);
    expect(await envText()).toBe(protectedEnv);
  });

  it('rejects an empty key list', async () => {
    const response = await post('/api/values/unset', {
      file: '.env',
      fingerprint: BASE,
      keys: [],
    });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/files', () => {
  it('gives each file its fingerprint, null when it does not exist', async () => {
    const response = await request(server.url)
      .get('/api/files')
      .set('Authorization', bearer);
    expect(
      response.body.files.map(
        (file: { fingerprint: unknown }) => file.fingerprint,
      ),
    ).toEqual([BASE, null]);
  });
});

describe('a cookie-authenticated write', () => {
  const cookie = () => `configure_env_token_${server.port}=${TOKEN}`;
  const body = { file: '.env', fingerprint: BASE, values: { PORT: '9090' } };

  it('is refused without an Origin, writing nothing', async () => {
    const response = await request(server.url)
      .post('/api/values/set')
      .set('Cookie', cookie())
      .send(body);
    expect(response.status).toBe(403);
    expect(await envText()).toBe(protectedEnv);
  });

  it('is refused from a foreign Origin', async () => {
    const response = await request(server.url)
      .post('/api/values/set')
      .set('Cookie', cookie())
      .set('Origin', 'http://evil.example')
      .send(body);
    expect(response.status).toBe(403);
    expect(await envText()).toBe(protectedEnv);
  });

  it('is accepted from its own Origin', async () => {
    const response = await request(server.url)
      .post('/api/values/set')
      .set('Cookie', cookie())
      .set('Origin', server.url)
      .send(body);
    expect(response.status).toBe(200);
  });
});
