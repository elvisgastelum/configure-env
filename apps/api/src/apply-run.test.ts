// The plan inputs `configure-env apply` sends: keys to generate on the
// server and keys to defer, which also turn on apply's checks of a run.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_STATE_PATH, readChanges } from '@configure-env/core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  type ApiServer,
  TOKEN,
  removeProject,
  startServer,
  writeProject,
} from './test-helpers.ts';

const schema = {
  version: 1,
  variables: {
    API_URL: { type: 'url', required: true },
    SECRET: { type: 'string', secret: true },
    SHORT: { type: 'string', secret: true, maxLength: 8 },
    NAME: { type: 'string' },
    TOKEN_A: { type: 'string', conflictsWith: ['TOKEN_B'] },
    TOKEN_B: { type: 'string' },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*' },
    { path: 'app.env', policy: 'merge', variables: ['SECRET', 'NAME'] },
  ],
};

let root: string;
let server: ApiServer;

async function open(files: Record<string, string> = {}) {
  root = await writeProject({
    'env.schema.json': JSON.stringify(schema),
    ...files,
  });
  server = await startServer(root);
}

afterEach(async () => {
  await server?.close();
  await removeProject(root);
});

const post = (path: string, body: object, client?: string) => {
  const sent = request(server.url)
    .post(path)
    .set('Authorization', `Bearer ${TOKEN}`);
  return (client ? sent.set('X-Configure-Env-Client', client) : sent).send(
    body,
  );
};
const read = (path: string) =>
  readFile(join(root, path), 'utf8').catch(() => undefined);
const valueIn = (text: string | undefined, key: string) =>
  text?.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];

describe('generate', () => {
  it('plans a generated value, never answered, and applies that same value', async () => {
    await open();
    const inputs = {
      values: { API_URL: 'https://x.test' },
      generate: ['SECRET'],
    };
    const plan = await post('/api/plan', inputs);
    expect(plan.status).toBe(200);
    expect(plan.body.ok).toBe(true);
    const masked = plan.body.generated.SECRET as string;
    expect(masked).toMatch(/^••••.{2}$/);
    expect(plan.body.files[0].diff).toContainEqual({
      kind: 'added',
      line: `SECRET=${masked}`,
    });
    expect(await read('.env')).toBeUndefined();

    const applied = await post(
      '/api/apply',
      { ...inputs, fingerprint: plan.body.fingerprint },
      'cli',
    );
    expect(applied.status).toBe(200);
    const value = valueIn(await read('.env'), 'SECRET')!;
    expect(value).toHaveLength(48);
    expect(masked.endsWith(value.slice(-2))).toBe(true);
    // One secret per run: both files take the same value.
    expect(valueIn(await read('app.env'), 'SECRET')).toBe(value);
    expect(JSON.stringify([plan.body, applied.body])).not.toContain(value);
    const rows = await readChanges(join(root, DEFAULT_STATE_PATH));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actor === 'cli')).toBe(true);
  });

  it('uses the value a file of the run holds instead of a new one', async () => {
    await open({ 'app.env': 'SECRET=held-secret-value-123\nNAME=x\n' });
    const inputs = {
      values: { API_URL: 'https://x.test' },
      generate: ['SECRET'],
    };
    const plan = await post('/api/plan', inputs);
    expect(plan.body.generated).toEqual({ SECRET: '••••23' });
    await post('/api/apply', { ...inputs, fingerprint: plan.body.fingerprint });
    expect(valueIn(await read('.env'), 'SECRET')).toBe('held-secret-value-123');
  });

  it('refuses files that hold different values, writing nothing', async () => {
    await open({
      '.env': 'SECRET=one-secret-value-1\n',
      'app.env': 'SECRET=two-secret-value-2\n',
    });
    const response = await post('/api/plan', { generate: ['SECRET'] });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      statusCode: 422,
      kind: 'inputs',
      message: 'SECRET: --generate found different values in .env, app.env',
      errors: [
        {
          kind: 'usage',
          key: 'SECRET',
          message: '--generate found different values in .env, app.env',
        },
      ],
      hints: [
        'set the same value in each, or pass --file to leave one out of the run',
      ],
    });
  });

  it('refuses a key that is not a secret string, and one too short to generate', async () => {
    await open();
    const plain = await post('/api/plan', { generate: ['NAME'] });
    expect(plain.status).toBe(422);
    expect(plain.body.errors).toEqual([
      {
        kind: 'usage',
        key: 'NAME',
        message: '--generate takes a secret string variable',
      },
    ]);
    const short = await post('/api/plan', { generate: ['SHORT'] });
    expect(short.status).toBe(422);
    expect(short.body.message).toBe(
      'SHORT: maxLength 8 is too short for a generated secret; set it with --prompt or --stdin',
    );
  });

  it('forgets the generated value once an apply names its plan', async () => {
    await open();
    const inputs = {
      values: { API_URL: 'https://x.test' },
      generate: ['SECRET'],
    };
    const plan = await post('/api/plan', inputs);
    const named = { ...inputs, fingerprint: plan.body.fingerprint };
    expect((await post('/api/apply', named)).status).toBe(200);
    // The files back as the plan saw them: its value is gone, so the same
    // apply makes a new one and the plan differs.
    await rm(join(root, '.env'));
    await rm(join(root, 'app.env'));
    expect((await post('/api/apply', named)).status).toBe(409);
    expect(await read('.env')).toBeUndefined();
  });

  it('forgets it after a refused apply too', async () => {
    await open();
    const inputs = { generate: ['SECRET'], defer: [] };
    const plan = await post('/api/plan', inputs);
    expect(plan.body.ok).toBe(false);
    const named = { ...inputs, fingerprint: plan.body.fingerprint };
    expect((await post('/api/apply', named)).status).toBe(422);
    // Kept, the same apply would be refused again (422); the value is gone,
    // so a new one makes the plan differ.
    expect((await post('/api/apply', named)).status).toBe(409);
    expect(await read('.env')).toBeUndefined();
  });

  it('reuses a value a file of generateFiles holds, planning only files', async () => {
    await open({ 'app.env': 'SECRET=held-secret-value-123\nNAME=x\n' });
    const inputs = {
      values: { API_URL: 'https://x.test' },
      files: ['.env'],
      generateFiles: ['.env', 'app.env'],
      generate: ['SECRET'],
      defer: [],
    };
    const plan = await post('/api/plan', inputs);
    expect(plan.body.ok).toBe(true);
    expect(plan.body.files.map((file: { path: string }) => file.path)).toEqual([
      '.env',
    ]);
    await post('/api/apply', { ...inputs, fingerprint: plan.body.fingerprint });
    expect(valueIn(await read('.env'), 'SECRET')).toBe('held-secret-value-123');
  });

  it('leaves a prompted value that conflicts with a generated key to the rules', async () => {
    await open();
    const conflicting = {
      version: 1,
      variables: {
        GEN: { type: 'string', secret: true, conflictsWith: ['B'] },
        B: { type: 'string' },
      },
      files: [{ path: '.env', policy: 'merge', variables: '*' }],
    };
    await writeFile(join(root, 'env.schema.json'), JSON.stringify(conflicting));
    const given = await post('/api/plan', {
      values: { B: 'b' },
      generate: ['GEN'],
      defer: [],
    });
    expect(given.status).toBe(422);
    expect(given.body.errors).toEqual([
      {
        kind: 'usage',
        key: 'GEN',
        message: '--generate would set it while B is set; set only one of them',
      },
    ]);
    const prompted = await post('/api/plan', {
      values: { B: 'b' },
      prompted: ['B'],
      generate: ['GEN'],
      defer: [],
    });
    expect(prompted.status).toBe(200);
    expect(prompted.body.errors).toEqual([
      {
        kind: 'value',
        key: 'GEN',
        keys: ['GEN', 'B'],
        message: 'set only one of them',
      },
    ]);
  });

  it('answers 409 to an apply whose generated value was never planned', async () => {
    await open();
    const response = await post('/api/apply', {
      values: { API_URL: 'https://x.test' },
      generate: ['SECRET'],
      fingerprint: 'sha256:never-planned',
    });
    expect(response.status).toBe(409);
    expect(await read('.env')).toBeUndefined();
  });
});

describe('defer', () => {
  it('reports a required value nothing gives once defer is given', async () => {
    await open();
    const plan = await post('/api/plan', { defer: [] });
    expect(plan.body.ok).toBe(false);
    expect(plan.body.errors).toEqual([
      { kind: 'value', key: 'API_URL', message: 'is required' },
    ]);
  });

  it('leaves a deferred key empty and names it per file', async () => {
    await open();
    const inputs = { defer: ['API_URL'] };
    const plan = await post('/api/plan', inputs);
    expect(plan.body.ok).toBe(true);
    expect(
      plan.body.files.map((file: { deferred: string[] }) => file.deferred),
    ).toEqual([['API_URL'], []]);
    await post('/api/apply', { ...inputs, fingerprint: plan.body.fingerprint });
    expect(valueIn(await read('.env'), 'API_URL')).toBe('');
  });

  it('checks the rules between variables once defer is given', async () => {
    await open();
    const values = {
      API_URL: 'https://x.test',
      TOKEN_A: 'a',
      TOKEN_B: 'b',
    };
    const plan = await post('/api/plan', { values, defer: [] });
    expect(plan.body.ok).toBe(false);
    expect(plan.body.errors).toEqual([
      expect.objectContaining({ kind: 'value', key: 'TOKEN_A' }),
    ]);
  });

  it('keeps the plan without defer as it was: no required or rule check', async () => {
    await open();
    const plan = await post('/api/plan', {
      values: { TOKEN_A: 'a', TOKEN_B: 'b' },
    });
    expect(plan.body).toMatchObject({ ok: true, errors: [] });
    expect(plan.body).not.toHaveProperty('generated');
    expect(plan.body.files[0]).not.toHaveProperty('deferred');
    // The portal's apply is still recorded as the portal's.
    const applied = await post('/api/apply', {
      values: { TOKEN_A: 'a', TOKEN_B: 'b' },
      fingerprint: plan.body.fingerprint,
    });
    expect(applied.status).toBe(200);
    const rows = await readChanges(join(root, DEFAULT_STATE_PATH));
    expect(rows.every((row) => row.actor === 'portal')).toBe(true);
  });

  it('refuses an optional or undeclared key', async () => {
    await open();
    const response = await post('/api/plan', { defer: ['NAME'] });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      {
        kind: 'usage',
        key: 'NAME',
        message: '--defer takes a required variable',
      },
    ]);
  });
});

describe('replaced', () => {
  it('names the protected values replaceProtected would replace', async () => {
    root = await writeProject({
      'env.schema.json': JSON.stringify({
        version: 1,
        variables: {
          KEY: { type: 'string', secret: true, protected: true },
        },
        files: [{ path: '.env', policy: 'generate', variables: '*' }],
      }),
      '.env': 'KEY=old-secret\n',
    });
    server = await startServer(root);
    const first = await post('/api/plan', {});
    await post('/api/apply', { fingerprint: first.body.fingerprint });
    const plan = await post('/api/plan', {
      values: { KEY: 'new-secret' },
      replaceProtected: ['KEY'],
    });
    expect(plan.body.replaced).toEqual([{ file: '.env', key: 'KEY' }]);
  });
});
