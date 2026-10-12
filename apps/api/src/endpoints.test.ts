import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { schemaFingerprint } from '@configure-env/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ApiServer,
  DB_PASSWORD,
  TOKEN,
  fixtureEnv,
  fixtureProject,
  fixtureSchema,
  removeProject,
  startServer,
  writeProject,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
let root: string;
let server: ApiServer;

const get = (path: string) =>
  request(server.url).get(path).set('Authorization', bearer);
const reveal = (body: object) =>
  request(server.url)
    .post('/api/reveal')
    .set('Authorization', bearer)
    .send(body);

beforeAll(async () => {
  root = await fixtureProject();
  server = await startServer(root);
});

afterAll(async () => {
  await server.close();
  await removeProject(root);
});

describe('GET /api/schema', () => {
  it('returns the schema document', async () => {
    const response = await get('/api/schema');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      path: 'env.schema.json',
      valid: true,
      document: fixtureSchema,
      errors: [],
      fingerprint: schemaFingerprint(JSON.stringify(fixtureSchema, null, 2)),
    });
  });
});

describe('GET /api/variables', () => {
  it('lists every variable with its spec and per-file status', async () => {
    const response = await get('/api/variables');
    expect(response.status).toBe(200);
    const byName = Object.fromEntries(
      response.body.variables.map((v: { name: string }) => [v.name, v]),
    );
    expect(Object.keys(byName)).toEqual(Object.keys(fixtureSchema.variables));
    expect(byName.API_URL.spec).toMatchObject({ type: 'url', required: true });
    expect(byName.API_URL.files).toEqual([
      {
        file: '.env',
        status: 'invalid',
        value: 'not-a-url',
        error: expect.any(String),
      },
      { file: '.env.example', status: 'missing' },
    ]);
    expect(byName.PORT.files).toEqual([
      { file: '.env', status: 'set', value: '8080' },
      { file: '.env.example', status: 'missing' },
      { file: 'config/app.env', status: 'missing' },
    ]);
    expect(byName.API_KEY.files[0]).toEqual({
      file: '.env',
      status: 'missing',
    });
  });

  it('masks secrets', async () => {
    const response = await get('/api/variables');
    expect(response.text).not.toContain(DB_PASSWORD);
    const password = response.body.variables.find(
      (v: { name: string }) => v.name === 'DB_PASSWORD',
    );
    expect(password.files[0]).toEqual({
      file: '.env',
      status: 'masked',
      value: '••••le',
    });
  });
});

describe('GET /api/files', () => {
  it('reports policy, mode, drift and parse errors', async () => {
    const response = await get('/api/files');
    expect(response.status).toBe(200);
    const [env, example, app] = response.body.files;
    expect(env).toEqual({
      path: '.env',
      policy: 'merge',
      template: false,
      exists: true,
      mode: { expected: '600', actual: '644' },
      drift: {
        status: 'missing-keys',
        drift: true,
        missingKeys: ['API_KEY'],
        unknownKeys: ['EXTRA'],
      },
      parseErrors: [{ line: 6, message: 'is not a valid entry' }],
      fingerprint: schemaFingerprint(fixtureEnv),
    });
    expect(example).toMatchObject({
      path: '.env.example',
      policy: 'generate',
      template: true,
      exists: false,
      mode: { expected: null, actual: null },
      drift: { status: 'missing', drift: true },
      fingerprint: null,
    });
    expect(app.path).toBe('config/app.env');
  });
});

describe('POST /api/reveal', () => {
  it('reveals one secret', async () => {
    const response = await reveal({ file: '.env', key: 'DB_PASSWORD' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      file: '.env',
      key: 'DB_PASSWORD',
      value: DB_PASSWORD,
    });
  });

  it('gives null for an unset value', async () => {
    const response = await reveal({ file: '.env', key: 'API_KEY' });
    expect(response.body.value).toBeNull();
  });

  it('refuses a path that is not a schema file', async () => {
    const response = await reveal({
      file: '../etc/passwd',
      key: 'DB_PASSWORD',
    });
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('root:');
  });

  it("refuses a key that is not one of the file's variables", async () => {
    const response = await reveal({
      file: 'config/app.env',
      key: 'DB_PASSWORD',
    });
    expect(response.status).toBe(404);
  });

  it('validates the body', async () => {
    expect((await reveal({ file: '.env' })).status).toBe(400);
    expect(
      (await reveal({ file: '.env', key: 'PORT', extra: true })).status,
    ).toBe(400);
  });
});

describe('GET /api/check', () => {
  it('reports drift with secrets masked', async () => {
    const response = await get('/api/check');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.drift).toBe(true);
    const env = response.body.files[0];
    expect(env).toMatchObject({
      path: '.env',
      status: 'missing-keys',
      mode: { actual: '644', expected: '600' },
      invalidLines: [6],
      unknownKeys: [],
    });
    expect(env.invalid).toEqual([
      { key: 'API_URL', message: expect.any(String), shown: 'not-a-url' },
    ]);
    expect(response.text).not.toContain(DB_PASSWORD);
  });

  it('reports unknown keys when strict', async () => {
    const response = await get('/api/check?strict=true');
    expect(response.body.files[0].unknownKeys).toEqual(['EXTRA']);
  });

  it('validates the query', async () => {
    expect((await get('/api/check?strict=yes')).status).toBe(400);
  });
});

describe('GET /api/validate', () => {
  it('reports rule and value errors per file', async () => {
    const response = await get('/api/validate');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    const [env, example] = response.body.files;
    expect(env).toMatchObject({ path: '.env', exists: true, ok: false });
    expect(env.errors).toEqual([
      { line: 6, message: 'is not a valid entry' },
      { key: 'API_URL', message: expect.any(String) },
    ]);
    expect(env.warnings).toEqual([
      { key: 'EXTRA', message: 'is not in the schema for this file' },
    ]);
    expect(example).toMatchObject({
      path: '.env.example',
      template: true,
      exists: false,
      errors: [{ message: 'missing' }],
    });
  });

  it('turns unknown keys into errors when strict', async () => {
    const response = await get('/api/validate?strict=true');
    expect(response.body.files[0].warnings).toEqual([]);
    expect(response.body.files[0].errors).toContainEqual({
      key: 'EXTRA',
      message: 'is not in the schema for this file',
    });
  });
});

describe('GET /api/openapi.json', () => {
  it('serves the OpenAPI document', async () => {
    const response = await get('/api/openapi.json');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.paths)).toContain('/api/reveal');
  });
});

describe('an invalid schema', () => {
  let bad: string;
  let badServer: ApiServer;

  beforeAll(async () => {
    bad = await writeProject({
      'env.schema.json': JSON.stringify({
        version: 1,
        variables: { PORT: { type: 'port', default: 'x' } },
        files: [{ path: '../outside.env', policy: 'merge', variables: '*' }],
      }),
    });
    badServer = await startServer(bad);
  });

  afterAll(async () => {
    await badServer.close();
    await removeProject(bad);
  });

  it('is reported with JSON paths', async () => {
    const response = await request(badServer.url)
      .get('/api/schema')
      .set('Authorization', bearer);
    expect(response.body.valid).toBe(false);
    expect(response.body.document).toMatchObject({ version: 1 });
    expect(response.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['variables.PORT.default', 'files[0].path']),
    );
  });

  it('answers 422 where a valid schema is needed', async () => {
    const response = await request(badServer.url)
      .get('/api/variables')
      .set('Authorization', bearer);
    expect(response.status).toBe(422);
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  it('reports a syntax error with its position', async () => {
    await writeFile(join(bad, 'env.schema.json'), '{\n  "version": 1,\n');
    const response = await request(badServer.url)
      .get('/api/schema')
      .set('Authorization', bearer);
    expect(response.body).toMatchObject({ valid: false, document: null });
    expect(response.body.errors[0]).toMatchObject({ path: '(root)', line: 3 });
  });
});

describe('a file that escapes the root through a symlink', () => {
  let linked: string;
  let outside: string;
  let linkedServer: ApiServer;

  beforeAll(async () => {
    outside = await writeProject({
      'secret.env': 'DB_PASSWORD=outside-value-123\n',
    });
    linked = await writeProject({
      'env.schema.json': JSON.stringify({
        version: 1,
        variables: { DB_PASSWORD: { type: 'string', secret: true } },
        files: [{ path: 'linked/.env', policy: 'merge', variables: '*' }],
      }),
    });
    await symlink(outside, join(linked, 'linked'));
    linkedServer = await startServer(linked);
  });

  afterAll(async () => {
    await linkedServer.close();
    await removeProject(linked);
    await removeProject(outside);
  });

  const call = (path: string) =>
    request(linkedServer.url).get(path).set('Authorization', bearer);

  it('is refused by reveal', async () => {
    const response = await request(linkedServer.url)
      .post('/api/reveal')
      .set('Authorization', bearer)
      .send({ file: 'linked/.env', key: 'DB_PASSWORD' });
    expect(response.status).toBe(403);
    expect(response.text).not.toContain('outside-value');
  });

  it('is reported, never read, by files, variables and validate', async () => {
    const files = await call('/api/files');
    expect(files.body.files[0]).toMatchObject({
      exists: false,
      error: expect.stringMatching(/outside the root/),
    });
    const variables = await call('/api/variables');
    expect(variables.body.variables[0].files[0]).toMatchObject({
      status: 'missing',
    });
    const validate = await call('/api/validate');
    expect(validate.body.files[0].errors[0].message).toMatch(
      /outside the root/,
    );
    for (const response of [files, variables, validate])
      expect(response.text).not.toContain('outside-value');
  });

  it('cannot be the schema', async () => {
    await symlink(
      join(outside, 'secret.env'),
      join(linked, 'schema-link.json'),
    );
    await expect(startServer(linked, 'schema-link.json')).rejects.toThrow(
      /inside the root/,
    );
  });
});
