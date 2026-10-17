// A server reached from another machine: through a reverse proxy at its
// public URL, or over HTTPS directly. The public host joins the Host and
// Origin allow-list and every other host is still refused, the cookie is
// Secure over HTTPS, and open-in-editor never answers a proxied request.

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { EditorLauncher, EditorTarget } from './editor.ts';
import { createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  removeProject,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
const PUBLIC = 'https://env.example.com';

let root: string;
let launched: EditorTarget[];
const fakeLauncher: EditorLauncher = (target) => {
  launched.push(target);
  return Promise.resolve({ opened: true });
};

beforeAll(async () => {
  root = await fixtureProject();
});

afterAll(async () => {
  await removeProject(root);
});

describe('a public URL', () => {
  let server: ApiServer;
  /** The address the server listens on, as a proxy on this machine reaches it. */
  let local: string;

  beforeAll(async () => {
    launched = [];
    server = await createServer({
      root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
      publicUrl: PUBLIC,
      editor: fakeLauncher,
    });
    local = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('is the URL and the launch URL the server reports', () => {
    expect(server.url).toBe(PUBLIC);
    expect(server.launchUrl).toBe(
      `${PUBLIC}/launch?token=${encodeURIComponent(TOKEN)}`,
    );
  });

  it('accepts a request for the public host', async () => {
    const response = await request(local)
      .get('/api/health')
      .set('Host', 'env.example.com')
      .set('Authorization', bearer);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('still needs the token for the public host', async () => {
    const response = await request(local)
      .get('/api/health')
      .set('Host', 'env.example.com');
    expect(response.status).toBe(401);
  });

  it('still refuses an unknown host', async () => {
    const response = await request(local)
      .get('/api/health')
      .set('Host', 'evil.example.com')
      .set('Authorization', bearer);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/host not allowed/);
  });

  it('still answers its own bound address', async () => {
    const response = await request(local)
      .get('/api/health')
      .set('Authorization', bearer);
    expect(response.status).toBe(200);
  });

  it('accepts the public origin and refuses it over another scheme', async () => {
    const allowed = await request(local)
      .get('/api/health')
      .set('Host', 'env.example.com')
      .set('Origin', PUBLIC)
      .set('Authorization', bearer);
    expect(allowed.status).toBe(200);
    const http = await request(local)
      .get('/api/health')
      .set('Host', 'env.example.com')
      .set('Origin', 'http://env.example.com')
      .set('Authorization', bearer);
    expect(http.status).toBe(403);
    expect(http.body.message).toMatch(/origin not allowed/);
  });

  it('sets a Secure session cookie for an https public URL', async () => {
    const response = await request(local)
      .get(`/launch?token=${encodeURIComponent(TOKEN)}`)
      .set('Host', 'env.example.com');
    expect(response.status).toBe(303);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it('refuses open-in-editor through the public host or a proxy', async () => {
    const viaHost = await request(local)
      .post('/api/open-in-editor')
      .set('Host', 'env.example.com')
      .set('Authorization', bearer)
      .send({ file: 'env.schema.json' });
    expect(viaHost.status).toBe(403);
    const forwarded = await request(local)
      .post('/api/open-in-editor')
      .set('X-Forwarded-For', '203.0.113.7')
      .set('Authorization', bearer)
      .send({ file: 'env.schema.json' });
    expect(forwarded.status).toBe(403);
    expect(forwarded.body.message).toBe(
      'open-in-editor answers only requests from this machine',
    );
    expect(launched).toEqual([]);
  });

  it.each([
    'env.example.com',
    'ftp://env.example.com',
    'https://env.example.com/portal',
    'https://env.example.com/?a=1',
    'https://user:pass@env.example.com',
  ])('is refused when it is %s', async (publicUrl) => {
    await expect(
      createServer({
        root,
        schemaPath: 'env.schema.json',
        port: 0,
        token: TOKEN,
        publicUrl,
      }),
    ).rejects.toThrow(/public URL/);
  });
});

describe('a plain HTTP server', () => {
  it('sets no Secure cookie, as before', async () => {
    const server = await createServer({
      root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
    });
    try {
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
      const response = await request(server.url).get(
        `/launch?token=${encodeURIComponent(TOKEN)}`,
      );
      expect(response.headers['set-cookie']?.[0] ?? '').not.toMatch(/Secure/);
    } finally {
      await server.close();
    }
  });
});

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A self-signed certificate for 127.0.0.1 and localhost, made with openssl. */
async function testCertificate(dir: string) {
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  return { cert: await readFile(cert), key: await readFile(key) };
}

/** GET `path` over HTTPS, trusting `ca`. */
function httpsGet(url: string, ca: Buffer, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string; cookie?: string }>(
    (resolve, reject) => {
      const req = httpsRequest(url, { ca, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            cookie: res.headers['set-cookie']?.[0],
          }),
        );
      });
      req.on('error', reject);
      req.end();
    },
  );
}

describe.skipIf(!hasOpenssl)('TLS', () => {
  let dir: string;
  let tls: { cert: Buffer; key: Buffer };
  let server: ApiServer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'configure-env-tls-'));
    tls = await testCertificate(dir);
    server = await createServer({
      root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
      tls,
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves HTTPS and reports an https URL', async () => {
    expect(server.url).toBe(`https://127.0.0.1:${server.port}`);
    expect(server.launchUrl.startsWith(`${server.url}/launch?token=`)).toBe(
      true,
    );
    const health = await httpsGet(`${server.url}/api/health`, tls.cert, {
      authorization: bearer,
    });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ status: 'ok' });
    const denied = await httpsGet(`${server.url}/api/health`, tls.cert, {});
    expect(denied.status).toBe(401);
  });

  it('accepts its https origin and sets a Secure cookie', async () => {
    const origin = await httpsGet(`${server.url}/api/health`, tls.cert, {
      authorization: bearer,
      origin: server.url,
    });
    expect(origin.status).toBe(200);
    const launch = await httpsGet(server.launchUrl, tls.cert, {});
    expect(launch.status).toBe(303);
    expect(launch.cookie).toMatch(/; Secure/);
  });

  it('answers no plain HTTP', async () => {
    await expect(
      fetch(`http://127.0.0.1:${server.port}/api/health`, {
        headers: { authorization: bearer },
      }).then((response) => response.status),
    ).rejects.toThrow();
  });
});
