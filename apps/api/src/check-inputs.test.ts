// What `configure-env check` needs from the API beyond GET /api/check: the
// --file paths and the --set values (in a body, never in a URL), the --state
// path, and a schema the person named outside the root.

import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  removeProject,
  startServer,
  writeProject,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
const SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 3000 },
    KEY: { type: 'string', secret: true, protected: true },
  },
  files: [
    { path: 'app.env', policy: 'generate', variables: ['PORT'] },
    { path: '.env', policy: 'merge', variables: '*' },
  ],
};

let roots: string[] = [];
let server: ApiServer | undefined;

async function project(files: Record<string, string> = {}) {
  const root = await writeProject({
    'env.schema.json': JSON.stringify(SCHEMA),
    'app.env': 'PORT=3000\n',
    '.env': 'PORT=3000\n',
    ...files,
  });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(roots.map(removeProject));
  roots = [];
});

const post = (path: string, body: object) =>
  request(server!.url).post(path).set('Authorization', bearer).send(body);

describe('POST /api/check', () => {
  it('answers what GET /api/check does without inputs', async () => {
    server = await startServer(await project());
    const get = await request(server.url)
      .get('/api/check?strict=true')
      .set('Authorization', bearer);
    const posted = await post('/api/check', { strict: true });
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual(get.body);
  });

  it('checks only the files given, comparing with the values given', async () => {
    server = await startServer(await project());
    const only = await post('/api/check', { files: ['app.env'] });
    expect(only.status).toBe(200);
    expect(only.body.files.map((file: { path: string }) => file.path)).toEqual([
      'app.env',
    ]);
    expect(only.body.ok).toBe(true);
    const valued = await post('/api/check', {
      files: ['app.env'],
      values: { PORT: '9999' },
    });
    expect(valued.body).toMatchObject({
      ok: false,
      files: [{ path: 'app.env', status: 'differs' }],
    });
  });

  it('refuses a file the schema does not list (400)', async () => {
    server = await startServer(await project());
    const response = await post('/api/check', { files: ['nope.env'] });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: 'nope.env: is not in the schema',
    });
  });
});

describe('POST /api/check/gitignore', () => {
  it('fixes and checks the files given only, with the values given', async () => {
    const root = await project();
    await mkdir(join(root, '.configure-env'));
    server = await startServer(root);
    const response = await post('/api/check/gitignore', {
      files: ['app.env'],
      values: { PORT: '9999' },
    });
    expect(response.status).toBe(200);
    expect(response.body.fixed).toEqual([
      expect.objectContaining({ gitignore: '.configure-env/.gitignore' }),
    ]);
    expect(response.body.check).toMatchObject({
      files: [{ path: 'app.env', status: 'differs' }],
      gitignore: [],
    });
  });
});

describe('createServer, as the CLI starts it', () => {
  it('reads the state at statePath, naming it as given, through a symlinked root', async () => {
    const real = await project();
    const link = `${real}-link`;
    await symlink(real, link);
    roots.push(link);
    await mkdir(join(real, 'custom'));
    await writeFile(join(real, 'custom/state.json'), 'nope');
    server = await createServer({
      root: link,
      schemaPath: 'env.schema.json',
      statePath: join(link, 'custom/state.db'),
      port: 0,
      token: TOKEN,
    });
    const response = await request(server.url)
      .get('/api/check')
      .set('Authorization', bearer);
    expect(response.status).toBe(503);
    expect(response.body.message).toBe(
      `invalid state ${join(link, 'custom/state.json')}: is not valid JSON`,
    );
    await rm(join(real, 'custom/state.json'));
    // The state folder is named relative to the root, as the CLI names it.
    await mkdir(join(real, '.configure-env'));
    await server.close();
    server = await createServer({
      root: link,
      schemaPath: 'env.schema.json',
      statePath: join(link, '.configure-env/state.db'),
      port: 0,
      token: TOKEN,
    });
    const check = await request(server.url)
      .get('/api/check')
      .set('Authorization', bearer);
    expect(check.status).toBe(200);
    expect(check.body.gitignore[0]).toMatchObject({
      code: 'state-not-ignored',
      path: '.configure-env',
    });
  });

  it('reads a schema outside the root only with schemaAnywhere', async () => {
    const root = await project();
    const outside = await writeProject({
      'shared.schema.json': JSON.stringify(SCHEMA),
    });
    roots.push(outside);
    const schemaPath = join(outside, 'shared.schema.json');
    await expect(
      createServer({ root, schemaPath, port: 0, token: TOKEN }),
    ).rejects.toThrow('the schema must be a regular file inside the root');
    server = await createServer({
      root,
      schemaPath,
      schemaAnywhere: true,
      port: 0,
      token: TOKEN,
    });
    const check = await request(server.url)
      .get('/api/check')
      .set('Authorization', bearer);
    expect(check.status).toBe(200);
    expect(check.body.summary.files).toBe(2);
  });
});
