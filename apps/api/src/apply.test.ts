import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_STATE_PATH,
  parseSchema,
  planChanges,
  readChanges,
} from '@configure-env/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ApiServer,
  SESSION_KEY,
  TOKEN,
  protectedEnv,
  protectedProject,
  protectedSchema,
  removeProject,
  startServer,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
// Built at run time: a literal hex value reads as a leaked secret to scanners.
const SECRET_TOKEN = 'ab'.repeat(16);
let root: string;
let server: ApiServer;

const post = (path: string, body: object) =>
  request(server.url).post(path).set('Authorization', bearer).send(body);
const read = (path: string) =>
  readFile(join(root, path), 'utf8').catch(() => undefined);
const history = () => readChanges(join(root, DEFAULT_STATE_PATH));

/** What the core plans for the same request: the bytes apply must write. */
async function expectedContent(values: Record<string, string>) {
  const parsed = parseSchema(protectedSchema);
  if (!parsed.ok) throw new Error('invalid fixture');
  const plan = await planChanges({ schema: parsed.schema, root, values });
  return Object.fromEntries(
    plan.files.map((file) => [file.path, file.content ?? file.previous]),
  );
}

beforeEach(async () => {
  root = await protectedProject();
  server = await startServer(root);
});

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

describe('POST /api/plan', () => {
  it('returns each file with its action and diff, writing nothing', async () => {
    const response = await post('/api/plan', {
      values: { TOKEN: SECRET_TOKEN },
    });
    expect(response.status).toBe(200);
    const { body } = response;
    expect(body).toMatchObject({
      ok: true,
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      errors: [],
      protected: [],
    });
    const [env, app] = body.files;
    expect(env).toMatchObject({
      path: '.env',
      policy: 'merge',
      action: 'update',
      addedKeys: ['TOKEN'],
      fingerprint: expect.stringMatching(/^sha256:/),
    });
    expect(env.diff).toContainEqual({ kind: 'added', line: 'TOKEN=••••ab' });
    expect(env.diff).toContainEqual({ kind: 'same', line: 'PORT=8080' });
    expect(env.diff).toContainEqual({
      kind: 'same',
      line: 'SESSION_KEY=••••89',
    });
    expect(app).toMatchObject({
      path: 'config/app.env',
      action: 'create',
      mode: '644',
      currentMode: null,
      fingerprint: null,
    });
    expect(app.diff).toContainEqual({ kind: 'added', line: 'PORT=3000' });
    const json = JSON.stringify(body);
    expect(json).not.toContain(SECRET_TOKEN);
    expect(json).not.toContain(SESSION_KEY);
    expect(await read('.env')).toBe(protectedEnv);
    expect(await read('config/app.env')).toBeUndefined();
  });

  it('reports the values that break their rules', async () => {
    const response = await post('/api/plan', { values: { PORT: 'nope' } });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ kind: 'value', key: 'PORT' }),
    ]);
  });

  it('rejects an invalid body', async () => {
    const response = await post('/api/plan', { values: { 'no-way': '1' } });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/apply', () => {
  it('writes exactly the plan it was shown', async () => {
    const values = { TOKEN: SECRET_TOKEN };
    const expected = await expectedContent(values);
    const plan = await post('/api/plan', { values });
    const response = await post('/api/apply', {
      values,
      fingerprint: plan.body.fingerprint,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      files: [
        { path: '.env', action: 'update', ok: true, written: true },
        { path: 'config/app.env', action: 'create', ok: true, written: true },
      ],
      warnings: [],
    });
    expect(await read('.env')).toBe(expected['.env']);
    expect(await read('config/app.env')).toBe(expected['config/app.env']);
    expect(JSON.stringify(response.body)).not.toContain(SECRET_TOKEN);
    const rows = await history();
    expect(rows).toContainEqual(
      expect.objectContaining({
        file: '.env',
        key: 'TOKEN',
        operation: 'set',
        afterPreview: '••••',
      }),
    );
    expect(JSON.stringify(rows)).not.toContain(SECRET_TOKEN);
    // Applied, the next plan has nothing left to do.
    const next = await post('/api/plan', { values });
    expect(
      next.body.files.map((file: { action: string }) => file.action),
    ).toEqual(['unchanged', 'unchanged']);
  });

  it('answers 409 with the new plan when a file changed since the plan', async () => {
    const plan = await post('/api/plan', {});
    const edited = `${protectedEnv}NAME2=x\n`;
    await writeFile(join(root, '.env'), edited);
    const response = await post('/api/apply', {
      fingerprint: plan.body.fingerprint,
    });
    expect(response.status).toBe(409);
    expect(response.body.plan.fingerprint).not.toBe(plan.body.fingerprint);
    expect(response.body.plan.files[0].fingerprint).toMatch(/^sha256:/);
    expect(await read('.env')).toBe(edited);
    expect(await read('config/app.env')).toBeUndefined();
  });

  it('answers 409 when the request differs from the plan shown', async () => {
    const plan = await post('/api/plan', { values: { TOKEN: SECRET_TOKEN } });
    const response = await post('/api/apply', {
      values: { TOKEN: 'ff'.repeat(16) },
      fingerprint: plan.body.fingerprint,
    });
    expect(response.status).toBe(409);
    expect(await read('.env')).toBe(protectedEnv);
  });

  it('refuses a plan with errors, writing nothing', async () => {
    const values = { PORT: 'nope' };
    const plan = await post('/api/plan', { values });
    const response = await post('/api/apply', {
      values,
      fingerprint: plan.body.fingerprint,
    });
    expect(response.status).toBe(422);
    expect(response.body.plan.errors).toHaveLength(1);
    expect(await read('config/app.env')).toBeUndefined();
  });

  it('refuses to bring back a different protected value unless replaced', async () => {
    // A first apply records SESSION_KEY; then the file loses it.
    const first = await post('/api/plan', {});
    await post('/api/apply', { fingerprint: first.body.fingerprint });
    await writeFile(
      join(root, '.env'),
      protectedEnv.replace(`SESSION_KEY=${SESSION_KEY}\n`, ''),
    );
    const values = { SESSION_KEY: 'a-different-session-key' };
    const plan = await post('/api/plan', { values });
    expect(plan.body.ok).toBe(false);
    expect(plan.body.protected).toEqual([
      expect.objectContaining({
        key: 'SESSION_KEY',
        message: expect.stringMatching(/was set on/),
        reason: 'signs every session',
      }),
    ]);
    const refused = await post('/api/apply', {
      values,
      fingerprint: plan.body.fingerprint,
    });
    expect(refused.status).toBe(422);
    expect(await read('.env')).not.toContain('SESSION_KEY');

    const replace = { values, replaceProtected: ['SESSION_KEY'] };
    const allowed = await post('/api/plan', replace);
    expect(allowed.body.ok).toBe(true);
    const response = await post('/api/apply', {
      ...replace,
      fingerprint: allowed.body.fingerprint,
    });
    expect(response.status).toBe(200);
    expect(response.body.replaced).toEqual([
      { file: '.env', key: 'SESSION_KEY' },
    ]);
    expect(await read('.env')).toContain('SESSION_KEY=a-different-session-key');
  });

  it('requires the plan fingerprint', async () => {
    const response = await post('/api/apply', {});
    expect(response.status).toBe(400);
  });
});
