import { basename } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  removeProject,
  startServer,
  writeProject,
} from './test-helpers.ts';

let root: string;
let server: ApiServer;
const bearer = `Bearer ${TOKEN}`;

beforeAll(async () => {
  root = await fixtureProject();
  server = await startServer(root);
});

afterAll(async () => {
  await server.close();
  await removeProject(root);
});

describe('the token', () => {
  it('is required on every request', async () => {
    const response = await request(server.url).get('/api/health');
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects a wrong token', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', `Bearer ${TOKEN}x`);
    expect(response.status).toBe(401);
  });

  it('accepts the bearer token', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('guards unknown paths too', async () => {
    const response = await request(server.url).get('/anything');
    expect(response.status).toBe(401);
  });
});

describe('the launch URL', () => {
  it('exchanges the token for an HttpOnly SameSite=Strict cookie', async () => {
    const launch = new URL(server.launchUrl);
    const response = await request(server.url).get(
      `${launch.pathname}${launch.search}`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const pair = cookie.split(';')[0]!;
    const health = await request(server.url)
      .get('/api/health')
      .set('Cookie', pair);
    expect(health.status).toBe(200);
  });

  it('refuses a wrong token and sets no cookie', async () => {
    const response = await request(server.url).get('/launch?token=nope');
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a cookie-authenticated POST without an Origin', async () => {
    const launch = new URL(server.launchUrl);
    const login = await request(server.url).get(
      `${launch.pathname}${launch.search}`,
    );
    const pair = login.headers['set-cookie']![0]!.split(';')[0]!;
    const response = await request(server.url)
      .post('/api/reveal')
      .set('Cookie', pair)
      .send({ file: '.env', key: 'DB_PASSWORD' });
    expect(response.status).toBe(403);

    const sameOrigin = await request(server.url)
      .post('/api/reveal')
      .set('Cookie', pair)
      .set('Origin', server.url)
      .send({ file: '.env', key: 'PORT' });
    expect(sameOrigin.status).toBe(200);
  });
});

describe('DNS rebinding and CSRF', () => {
  it('rejects a Host that is not the server', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer)
      .set('Host', `evil.example:${server.port}`);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/host/i);
  });

  it('accepts localhost for a loopback server', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer)
      .set('Host', `localhost:${server.port}`);
    expect(response.status).toBe(200);
  });

  it('rejects a foreign Origin', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer)
      .set('Origin', 'https://evil.example');
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/origin/i);
  });

  it('rejects a cross-site fetch', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer)
      .set('Sec-Fetch-Site', 'same-site');
    expect(response.status).toBe(403);
  });

  it('accepts its own Origin', async () => {
    const response = await request(server.url)
      .get('/api/health')
      .set('Authorization', bearer)
      .set('Origin', server.url);
    expect(response.status).toBe(200);
  });

  it('answers no CORS preflight', async () => {
    const response = await request(server.url)
      .options('/api/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('createServer', () => {
  it('binds 127.0.0.1 by default', () => {
    expect(server.host).toBe('127.0.0.1');
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
  });

  it('refuses a schema outside the root', async () => {
    await expect(startServer(root, '../env.schema.json')).rejects.toThrow(
      /inside the root/,
    );
  });

  it('refuses a short token', async () => {
    await expect(
      createServer({
        root,
        schemaPath: 'env.schema.json',
        port: 0,
        token: 'short',
      }),
    ).rejects.toThrow(/token/);
  });
});

describe('GET /api/project', () => {
  it('names the root, the schema path and the version', async () => {
    const response = await request(server.url)
      .get('/api/project')
      .set('Authorization', bearer);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      root,
      schemaPath: 'env.schema.json',
      version: expect.any(String),
    });
  });
});

describe('the static portal', () => {
  let portal: string;
  let portalServer: ApiServer;

  beforeAll(async () => {
    portal = await writeProject({ 'index.html': '<h1>portal</h1>' });
    portalServer = await createServer({
      root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
      staticDir: portal,
    });
  });

  afterAll(async () => {
    await portalServer.close();
    await removeProject(portal);
  });

  it('is served behind the token', async () => {
    expect((await request(portalServer.url).get('/')).status).toBe(401);
    const response = await request(portalServer.url)
      .get('/')
      .set('Authorization', bearer);
    expect(response.status).toBe(200);
    expect(response.text).toContain('portal');
  });

  it('tells a tab without the session to open the launch link again', async () => {
    const page = await request(portalServer.url)
      .get('/variables')
      .set('Accept', 'text/html,application/xhtml+xml');
    expect(page.status).toBe(401);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.text).toContain('Open the launch link again');
    expect(page.text).not.toContain('<h1>portal</h1>');
    // Anything but a page keeps the JSON answer.
    const api = await request(portalServer.url)
      .get('/api/project')
      .set('Accept', 'text/html');
    expect(api.status).toBe(401);
    expect(api.headers['content-type']).toMatch(/^application\/json/);
    const script = await request(portalServer.url).get('/assets/index.js');
    expect(script.status).toBe(401);
    expect(script.headers['content-type']).toMatch(/^application\/json/);
  });

  it('answers a deep link with the portal, so the router can take it', async () => {
    expect((await request(portalServer.url).get('/files')).status).toBe(401);
    const response = await request(portalServer.url)
      .get('/variables?focus=PORT')
      .set('Authorization', bearer)
      .set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.text).toContain('portal');
  });

  it('keeps 404s for the API, missing assets and non-page requests', async () => {
    const api = await request(portalServer.url)
      .get('/api/nothing')
      .set('Authorization', bearer)
      .set('Accept', 'text/html');
    expect(api.status).toBe(404);
    expect(api.text).not.toContain('portal');

    const asset = await request(portalServer.url)
      .get('/assets/missing.js')
      .set('Authorization', bearer)
      .set('Accept', 'text/html');
    expect(asset.status).toBe(404);

    const json = await request(portalServer.url)
      .get('/variables')
      .set('Authorization', bearer)
      .set('Accept', 'application/json');
    expect(json.status).toBe(404);

    const post = await request(portalServer.url)
      .post('/variables')
      .set('Authorization', bearer)
      .set('Accept', 'text/html');
    expect(post.status).toBe(404);
  });

  it('never serves a file outside its directory', async () => {
    const response = await request(portalServer.url)
      .get(`/..%2f${basename(root)}%2fenv.schema.json`)
      .set('Authorization', bearer);
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('variables');
  });
});
