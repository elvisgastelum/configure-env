import { EventEmitter } from 'node:events';
import { type IncomingMessage, get } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
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

/**
 * Opens the event stream. It resolves once the server says it is watching,
 * or, with `ready: 'response'`, as soon as the response arrives: all a
 * browser's EventSource sees (its `open`), as it never shows comments.
 */
function subscribe({
  ready = 'watching',
}: { ready?: 'watching' | 'response' } = {}): Promise<{
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
              if (frame === ': watching' && ready === 'watching')
                resolve({ response, next });
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
            const queued = frames.shift();
            if (queued) parse(queued);
            else waiting.push(parse);
          });
        if (ready === 'response') resolve({ response, next });
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

  it('sends changed for a change made as soon as the stream opens', async () => {
    const { next } = await subscribe({ ready: 'response' });
    await writeFile(join(root, '.env'), 'PORT=1\n');
    expect(await next()).toEqual({
      event: 'changed',
      data: { paths: expect.arrayContaining(['.env']) },
    });
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
      headersSent: false,
      sent: '',
      writeHead: () => {
        res.headersSent = true;
        return res;
      },
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

  it('ends a stream still waiting to be answered as an event stream when the server closes', async () => {
    const events = new ProjectEvents(
      await resolveProject(root, 'env.schema.json'),
    );
    const res = Object.assign(fakeResponse(), { head: 0 });
    const writeHead = res.writeHead;
    res.writeHead = () => {
      res.head++;
      return writeHead();
    };
    const subscribed = events.subscribe(res as never);
    events.onModuleDestroy();
    await subscribed;
    // EventSource gives up for good on a response that is not an event
    // stream; with the headers it can reconnect to the next server.
    expect(res.head).toBe(1);
    expect(res.writableEnded).toBe(true);
  });

  it('answers a listener that joins while the first arms only once it watches', async () => {
    const events = new ProjectEvents(
      await resolveProject(root, 'env.schema.json'),
    );
    const first = fakeResponse();
    const second = fakeResponse();
    // How many directories were watched when each stream got its first byte.
    const watchingAtFirstWrite = (res: ReturnType<typeof fakeResponse>) =>
      new Promise<number>((done) => {
        const write = res.write;
        res.write = (text: string) => {
          if (!res.sent) done(events.watching);
          return write(text);
        };
      });
    const firstSaw = watchingAtFirstWrite(first);
    const secondSaw = watchingAtFirstWrite(second);
    await Promise.all([
      events.subscribe(first as never),
      events.subscribe(second as never),
    ]);
    expect(await firstSaw).toBe(1);
    expect(await secondSaw).toBe(1);
  });

  it('ends the stream when watching fails, so the listener reconnects and tries again', async () => {
    const events = new ProjectEvents(
      await resolveProject(root, 'env.schema.json'),
    );
    const watch = vi
      .spyOn(events as unknown as { watch: () => Promise<void> }, 'watch')
      .mockRejectedValueOnce(new Error('EMFILE'));
    const first = fakeResponse();
    await events.subscribe(first as never);
    // An event stream that ends: EventSource reconnects after `retry`.
    expect(first.headersSent).toBe(true);
    expect(first.sent).toBe('retry: 1000\n\n');
    expect(first.writableEnded).toBe(true);
    expect(events.watching).toBe(0);
    const again = fakeResponse();
    await events.subscribe(again as never);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(again.sent).toContain(': watching');
    expect(again.writableEnded).toBe(false);
    expect(events.watching).toBe(1);
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
