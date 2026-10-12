import { EventEmitter } from 'node:events';
import { type IncomingMessage, get } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectEvents } from './events.ts';
import { resolveProject } from './project.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  fixtureSchema,
  removeProject,
  startServer,
} from './test-helpers.ts';

let root: string;
let server: ApiServer;
const open: IncomingMessage[] = [];

beforeEach(async () => {
  root = await fixtureProject();
  server = await startServer(root);
});

afterEach(async () => {
  for (const stream of open.splice(0)) stream.destroy();
  await server.close();
  await removeProject(root);
});

/** Opens the event stream; resolves once the server says it is watching. */
function subscribe(): Promise<{
  response: IncomingMessage;
  next: () => Promise<{ event: string; data: unknown }>;
}> {
  return new Promise((resolve, reject) => {
    const req = get(
      `${server.url}/api/events`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      (response) => {
        open.push(response);
        response.setEncoding('utf8');
        let buffer = '';
        const waiting: ((text: string) => void)[] = [];
        const frames: string[] = [];
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith(':') || frame.startsWith('retry:')) {
              if (frame === ': watching') resolve({ response, next });
              continue;
            }
            const take = waiting.shift();
            if (take) take(frame);
            else frames.push(frame);
          }
        });
        const next = () =>
          new Promise<{ event: string; data: unknown }>((done) => {
            const parse = (frame: string) => {
              const fields = Object.fromEntries(
                frame.split('\n').map((line) => {
                  const at = line.indexOf(': ');
                  return [line.slice(0, at), line.slice(at + 2)];
                }),
              );
              done({
                event: fields.event ?? '',
                data: JSON.parse(fields.data ?? 'null'),
              });
            };
            const ready = frames.shift();
            if (ready) parse(ready);
            else waiting.push(parse);
          });
      },
    );
    req.on('error', reject);
  });
}

describe('GET /api/events', () => {
  it('sends changed when an env file changes outside the server', async () => {
    const { response, next } = await subscribe();
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    await writeFile(join(root, 'unrelated.txt'), 'x');
    await writeFile(join(root, '.env'), 'PORT=1\n');
    const { event, data } = await next();
    expect(event).toBe('changed');
    expect((data as { paths: string[] }).paths).toContain('.env');
    expect((data as { paths: string[] }).paths).not.toContain('unrelated.txt');
  });

  it('sends changed when the schema changes', async () => {
    const { next } = await subscribe();
    await writeFile(
      join(root, 'env.schema.json'),
      JSON.stringify(fixtureSchema),
    );
    // macOS may also report the fixture's own recent writes.
    expect(await next()).toEqual({
      event: 'changed',
      data: { paths: expect.arrayContaining(['env.schema.json']) },
    });
  });

  it('is behind the token and the Origin check', async () => {
    const anonymous = await request(server.url).get('/api/events');
    expect(anonymous.status).toBe(401);
    const foreign = await request(server.url)
      .get('/api/events')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Origin', 'http://evil.example');
    expect(foreign.status).toBe(403);
  });

  it('ends the stream when the server closes', async () => {
    const { response } = await subscribe();
    const ended = new Promise((done) => response.on('close', done));
    await server.close();
    await ended;
    // The fixture is removed after; a second close is harmless.
    server = await startServer(root);
  });
});

describe('ProjectEvents', () => {
  /** A response that records what it is sent. */
  const fakeResponse = () => {
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      sent: '',
      writeHead: () => res,
      write: (text: string) => {
        res.sent += text;
        return true;
      },
      end: () => {
        res.writableEnded = true;
        res.emit('close');
      },
    });
    return res;
  };

  it('watches only while someone listens, and stops on destroy', async () => {
    const events = new ProjectEvents(
      await resolveProject(root, 'env.schema.json'),
    );
    const first = fakeResponse();
    const second = fakeResponse();
    await events.subscribe(first as never);
    await events.subscribe(second as never);
    // The schema, .env, .env.example and config/app.env (config/ does not
    // exist yet): all in the root.
    expect(events.watching).toBe(1);
    first.emit('close');
    expect(events.watching).toBe(1);
    events.onModuleDestroy();
    expect(second.writableEnded).toBe(true);
    expect(events.watching).toBe(0);
    // Closed, it takes no one.
    const late = fakeResponse();
    await events.subscribe(late as never);
    expect(late.writableEnded).toBe(true);
    expect(events.watching).toBe(0);
  });

  it('stops watching when the last listener leaves', async () => {
    const events = new ProjectEvents(
      await resolveProject(root, 'env.schema.json'),
    );
    const res = fakeResponse();
    await events.subscribe(res as never);
    expect(events.watching).toBe(1);
    res.emit('close');
    expect(events.watching).toBe(0);
  });
});
