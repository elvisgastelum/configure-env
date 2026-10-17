// The gateway to the other environments: GET /api/environments lists them
// without their tokens, and /env/<name>/api/* forwards to that environment's
// server with its bearer token, behind this server's own guard. Nothing of
// the browser's session reaches the other server, and nothing of the other
// server's token reaches the browser.

import { writeFile } from 'node:fs/promises';
import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  createServer as createHttpServer,
  get,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { type RemoteEnvironment, createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  removeProject,
} from './test-helpers.ts';

const DEV_TOKEN = 'dev-token-abcdefghijklmnopqrstuvwxyz0123';
const ECHO_TOKEN = 'echo-token-abcdefghijklmnopqrstuvwxyz012';
const COOKIE = (port: number) =>
  `configure_env_token_${port}=${encodeURIComponent(TOKEN)}`;

/** What the echo server received: the last request. */
interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let localRoot: string;
let devRoot: string;
let local: ApiServer;
let dev: ApiServer;
let echo: Server;
let echoUrl: string;
let received: Received[];
/** What the echo server answers next: status and headers. */
let echoAnswer: { status: number; headers: Record<string, string> } = {
  status: 200,
  headers: {},
};
let environments: Record<string, RemoteEnvironment>;
const open: IncomingMessage[] = [];

beforeAll(async () => {
  localRoot = await fixtureProject();
  devRoot = await fixtureProject();
  dev = await createServer({
    root: devRoot,
    schemaPath: 'env.schema.json',
    port: 0,
    token: DEV_TOKEN,
    version: '9.8.7',
  });
  received = [];
  echo = createHttpServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      });
      res.writeHead(echoAnswer.status, {
        'Content-Type': 'application/json',
        ...echoAnswer.headers,
      });
      res.end(JSON.stringify({ echoed: true }));
    });
  });
  await new Promise<void>((done) => echo.listen(0, '127.0.0.1', done));
  echoUrl = `http://127.0.0.1:${(echo.address() as AddressInfo).port}`;
  // A port nothing listens on: bound once, then released.
  const closed = createHttpServer();
  await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
  const downPort = (closed.address() as AddressInfo).port;
  await new Promise<void>((done) => closed.close(() => done()));
  environments = {
    dev: { url: dev.url, token: DEV_TOKEN },
    echo: { url: `${echoUrl}/prefix`, token: ECHO_TOKEN },
    down: { url: `http://127.0.0.1:${downPort}`, token: ECHO_TOKEN },
  };
  local = await createServer({
    root: localRoot,
    schemaPath: 'env.schema.json',
    port: 0,
    token: TOKEN,
    environments: () => Promise.resolve(environments),
  });
});

afterAll(async () => {
  for (const stream of open.splice(0)) stream.destroy();
  await local.close();
  await dev.close();
  await new Promise<void>((done) => echo.close(() => done()));
  await removeProject(localRoot);
  await removeProject(devRoot);
});

const reset = () => {
  received = [];
  echoAnswer = { status: 200, headers: {} };
};

/** Every token a response must never hold. */
const SECRETS = [TOKEN, DEV_TOKEN, ECHO_TOKEN];
const leaks = (response: request.Response) => {
  const text = `${JSON.stringify(response.headers)}\n${response.text}`;
  return SECRETS.filter((secret) => text.includes(secret));
};

describe('GET /api/environments', () => {
  it('lists local and each environment with its URL, reachability and version, never a token', async () => {
    const response = await request(local.url)
      .get('/api/environments')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(leaks(response)).toEqual([]);
    const byName = Object.fromEntries(
      (
        response.body as {
          environments: { name: string; [key: string]: unknown }[];
        }
      ).environments.map((environment) => [environment.name, environment]),
    );
    expect(Object.keys(byName)).toEqual(['local', 'dev', 'echo', 'down']);
    expect(byName.local).toMatchObject({
      name: 'local',
      local: true,
      url: local.url,
      reachable: true,
    });
    expect(byName.dev).toEqual({
      name: 'dev',
      local: false,
      url: dev.url,
      reachable: true,
      version: '9.8.7',
    });
    expect(byName.down).toMatchObject({
      name: 'down',
      local: false,
      reachable: false,
    });
    expect(byName.down!.message).toMatch(/ECONNREFUSED/);
    for (const environment of Object.values(byName))
      expect(Object.keys(environment)).not.toContain('token');
  });

  it('needs this server’s own token', async () => {
    const response = await request(local.url).get('/api/environments');
    expect(response.status).toBe(401);
  });

  it('lists only local without environments', async () => {
    const plain = await createServer({
      root: localRoot,
      schemaPath: 'env.schema.json',
      port: 0,
      token: TOKEN,
    });
    try {
      const response = await request(plain.url)
        .get('/api/environments')
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(response.status).toBe(200);
      expect(
        (response.body as { environments: { name: string }[] }).environments,
      ).toEqual([
        {
          name: 'local',
          local: true,
          url: plain.url,
          reachable: true,
          version: expect.any(String),
        },
      ]);
    } finally {
      await plain.close();
    }
  });
});

describe('/env/<name>/api/*', () => {
  it('forwards to the environment with its bearer token, without the cookie, Origin or Sec-Fetch headers', async () => {
    reset();
    const response = await request(local.url)
      .get('/env/echo/api/variables?strict=true')
      .set('Cookie', `${COOKIE(local.port)}; other=1`)
      .set('Origin', local.url)
      .set('Referer', `${local.url}/variables`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Sec-Fetch-Mode', 'cors')
      .set('Sec-Fetch-Dest', 'empty')
      .set('Accept', 'application/json');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ echoed: true });
    expect(received).toHaveLength(1);
    const [upstream] = received;
    expect(upstream!.method).toBe('GET');
    expect(upstream!.url).toBe('/prefix/api/variables?strict=true');
    expect(upstream!.headers.authorization).toBe(`Bearer ${ECHO_TOKEN}`);
    expect(upstream!.headers.host).toBe(new URL(echoUrl).host);
    expect(upstream!.headers.accept).toBe('application/json');
    expect(upstream!.headers['x-configure-env-client']).toBe('portal');
    for (const name of [
      'cookie',
      'origin',
      'referer',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest',
    ])
      expect(upstream!.headers).not.toHaveProperty(name);
    expect(JSON.stringify(upstream!.headers)).not.toContain(TOKEN);
  });

  it('sends the environment’s token, never the local bearer, upstream', async () => {
    reset();
    const response = await request(local.url)
      .get('/env/echo/api/project')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(received[0]!.headers.authorization).toBe(`Bearer ${ECHO_TOKEN}`);
    expect(JSON.stringify(received[0]!.headers)).not.toContain(TOKEN);
  });

  it('forwards a change with its body', async () => {
    reset();
    const response = await request(local.url)
      .post('/env/echo/api/values')
      .set('Cookie', COOKIE(local.port))
      .set('Origin', local.url)
      .set('Content-Type', 'application/json')
      .send({ file: '.env', values: { PORT: '9090' } });
    expect(response.status).toBe(200);
    expect(received[0]).toMatchObject({
      method: 'POST',
      url: '/prefix/api/values',
      body: JSON.stringify({ file: '.env', values: { PORT: '9090' } }),
    });
    expect(received[0]!.headers['content-type']).toBe('application/json');
  });

  it('strips hop-by-hop headers and the ones Connection names, both ways', async () => {
    reset();
    echoAnswer = {
      status: 200,
      headers: {
        'Set-Cookie': 'remote_session=1; Path=/',
        'Access-Control-Allow-Origin': '*',
        'X-Remote-Detail': 'kept out',
        Connection: 'X-Remote-Detail',
      },
    };
    const response = await request(local.url)
      .get('/env/echo/api/project')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Connection', 'keep-alive, X-Private')
      .set('X-Private', 'secret')
      .set('Proxy-Authorization', 'Basic abc')
      .set('Forwarded', 'for=10.0.0.1')
      .set('X-Forwarded-For', '10.0.0.1')
      .set('TE', 'trailers');
    expect(response.status).toBe(200);
    for (const name of [
      'x-private',
      'proxy-authorization',
      'forwarded',
      'x-forwarded-for',
      'te',
    ])
      expect(received[0]!.headers).not.toHaveProperty(name);
    expect(response.headers).not.toHaveProperty('set-cookie');
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
    expect(response.headers).not.toHaveProperty('x-remote-detail');
    // The local guard's own headers still frame the answer.
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('needs this server’s own token before forwarding anything', async () => {
    reset();
    const none = await request(local.url).get('/env/echo/api/project');
    expect(none.status).toBe(401);
    const wrong = await request(local.url)
      .get('/env/echo/api/project')
      .set('Authorization', `Bearer ${ECHO_TOKEN}`);
    expect(wrong.status).toBe(401);
    const page = await request(local.url)
      .get('/env/echo/api/project')
      .set('Accept', 'text/html');
    expect(page.status).toBe(401);
    expect(received).toEqual([]);
  });

  it('refuses another origin, and a cookie change without its Origin', async () => {
    reset();
    const cross = await request(local.url)
      .get('/env/echo/api/project')
      .set('Cookie', COOKIE(local.port))
      .set('Origin', 'http://evil.example.com');
    expect(cross.status).toBe(403);
    const site = await request(local.url)
      .get('/env/echo/api/project')
      .set('Cookie', COOKIE(local.port))
      .set('Sec-Fetch-Site', 'cross-site');
    expect(site.status).toBe(403);
    const noOrigin = await request(local.url)
      .post('/env/echo/api/values')
      .set('Cookie', COOKIE(local.port))
      .send({});
    expect(noOrigin.status).toBe(403);
    const host = await request(local.url)
      .get('/env/echo/api/project')
      .set('Host', 'evil.example.com')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(host.status).toBe(403);
    expect(received).toEqual([]);
  });

  it('answers 404 for a name environments.json does not list', async () => {
    reset();
    for (const name of ['prod', 'local', 'constructor', '__proto__', '..']) {
      const response = await request(local.url)
        .get(`/env/${encodeURIComponent(name)}/api/project`)
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(response.status, name).toBe(404);
      expect(response.body.statusCode).toBe(404);
    }
    const named = await request(local.url)
      .get('/env/prod/api/project')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(named.body.message).toMatch(/no environment named prod/);
    expect(received).toEqual([]);
  });

  it('forwards only /api paths, never out of them', async () => {
    reset();
    for (const path of [
      '/env/echo',
      '/env/echo/',
      '/env/echo/launch?token=x',
      '/env/echo/api/../launch',
      '/env/echo/api/%2e%2e/launch',
      '/env/echo/api/%2E%2E/%2E%2E/x',
      '/env/echo/api/..%2flaunch',
      '/env/echo/api/a%5c..%5c..%5cx',
      '/env/echo/api//evil.example.com/x',
      '/env/echo/http://evil.example.com/api/x',
      '/env/http:%2f%2fevil.example.com/api/x',
    ]) {
      const response = await request(local.url)
        .get(path)
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(response.status, path).toBe(404);
    }
    expect(received).toEqual([]);
  });

  it('never forwards open-in-editor: it opens files on this machine', async () => {
    reset();
    const response = await request(local.url)
      .post('/env/echo/api/open-in-editor')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ file: '.env' });
    expect(response.status).toBe(403);
    expect(received).toEqual([]);
  });

  it('answers 502 naming an environment it cannot reach, without its token, logging nothing', async () => {
    const written: string[] = [];
    const spies = [
      vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        }),
      vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        }),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          written.push(args.map(String).join(' '));
        }),
      ),
    ];
    let response: request.Response;
    try {
      response = await request(local.url)
        .get('/env/down/api/project')
        .set('Authorization', `Bearer ${TOKEN}`);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(written.join('\n')).not.toMatch(
      new RegExp(SECRETS.map((secret) => secret).join('|')),
    );
    expect(response.status).toBe(502);
    expect(response.body.statusCode).toBe(502);
    expect(response.body.message).toMatch(
      /environment down at http:\/\/127\.0\.0\.1:\d+ is unreachable: ECONNREFUSED/,
    );
    expect(leaks(response)).toEqual([]);
  });

  it('answers 502 when the environment refuses its token, never as a local 401', async () => {
    reset();
    echoAnswer = {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    };
    const response = await request(local.url)
      .get('/env/echo/api/project')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/environment echo refused its token/);
    expect(response.headers).not.toHaveProperty('www-authenticate');
    expect(leaks(response)).toEqual([]);
  });

  it('passes the other server’s answers on, errors included', async () => {
    const response = await request(local.url)
      .get('/env/dev/api/project')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ version: '9.8.7', root: devRoot });
    const missing = await request(local.url)
      .post('/env/dev/api/files/content')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ nope: true });
    expect(missing.status).toBe(400);
    expect(missing.body.statusCode).toBe(400);
    expect(leaks(missing)).toEqual([]);
  });

  it('streams GET /env/<name>/api/events as it comes', async () => {
    const { response, next } = await new Promise<{
      response: IncomingMessage;
      next: () => Promise<string>;
    }>((resolve, reject) => {
      const req = get(
        `${local.url}/env/dev/api/events`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
        (response) => {
          open.push(response);
          response.setEncoding('utf8');
          let buffer = '';
          const frames: string[] = [];
          const waiting: ((frame: string) => void)[] = [];
          let watching = false;
          response.on('data', (chunk: string) => {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (frame === ': watching' && !watching) {
                watching = true;
                resolve({ response, next });
              }
              if (frame.startsWith(':') || frame.startsWith('retry:')) continue;
              const take = waiting.shift();
              if (take) take(frame);
              else frames.push(frame);
            }
          });
          const next = () =>
            new Promise<string>((done) => {
              const frame = frames.shift();
              if (frame !== undefined) done(frame);
              else waiting.push(done);
            });
        },
      );
      req.on('error', reject);
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    await writeFile(join(devRoot, '.env'), 'PORT=1234\n');
    const frame = await next();
    expect(frame).toMatch(/^event: changed\ndata: .*"\.env"/);
  });
});

describe('the guard in front of /api', () => {
  it('still needs the token and refuses another origin', async () => {
    const none = await request(local.url).get('/api/health');
    expect(none.status).toBe(401);
    const cross = await request(local.url)
      .get('/api/health')
      .set('Cookie', COOKIE(local.port))
      .set('Origin', 'http://evil.example.com');
    expect(cross.status).toBe(403);
    const ok = await request(local.url)
      .get('/api/health')
      .set('Cookie', COOKIE(local.port));
    expect(ok.status).toBe(200);
  });
});
