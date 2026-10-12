// The portal's build output is what the API serves: build it with this
// package's Vite config, start the real API over a fixture project with
// `staticDir` pointing at the output, and open it as a browser would, from
// the launch URL through to a deep link and an API call.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ApiServer, createServer } from '@configure-env/api';
import request from 'supertest';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const webDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TOKEN = 'serve-test-token-0123456789abcdefghijkl';

let outDir: string;
let root: string;
let server: ApiServer;
let cookie: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'configure-env-web-dist-'));
  root = await mkdtemp(join(tmpdir(), 'configure-env-web-project-'));
  await writeFile(
    join(root, 'env.schema.json'),
    JSON.stringify({
      version: 1,
      variables: { PORT: { type: 'port', default: 3000 } },
      files: [{ path: '.env', policy: 'merge', variables: '*' }],
    }),
  );

  await build({
    root: webDir,
    configFile: join(webDir, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });

  server = await createServer({
    root,
    schemaPath: 'env.schema.json',
    port: 0,
    token: TOKEN,
    staticDir: outDir,
  });

  // The launch URL trades the token for the session cookie.
  const launch = await request(server.url).get(
    new URL(server.launchUrl).pathname + new URL(server.launchUrl).search,
  );
  expect(launch.status).toBe(303);
  expect(launch.headers.location).toBe('/');
  const setCookie = launch.headers['set-cookie'] as unknown as string[];
  expect(setCookie[0]).toMatch(/HttpOnly; SameSite=Strict/);
  cookie = setCookie[0]!.split(';')[0]!;
});

afterAll(async () => {
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe('the built portal behind the API', () => {
  it('is refused without the session', async () => {
    expect((await request(server.url).get('/')).status).toBe(401);
  });

  it('serves the built index and its hashed assets', async () => {
    const index = await request(server.url).get('/').set('Cookie', cookie);
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toMatch(/^text\/html/);
    expect(index.text).toContain('<div id="root"></div>');

    const script =
      /<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"/.exec(
        index.text,
      )?.[1];
    expect(script).toBeDefined();
    const asset = await request(server.url).get(script!).set('Cookie', cookie);
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
  });

  it('answers a deep link with the index, for the router', async () => {
    const page = await request(server.url)
      .get('/files?focus=.env')
      .set('Cookie', cookie)
      .set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<div id="root"></div>');
  });

  it('answers the API on the same origin with the same cookie', async () => {
    const project = await request(server.url)
      .get('/api/project')
      .set('Cookie', cookie);
    expect(project.status).toBe(200);
    expect(project.body.schemaPath).toBe('env.schema.json');
  });
});
