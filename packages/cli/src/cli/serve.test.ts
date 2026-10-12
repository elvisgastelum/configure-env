// `configure-env serve`: its options, the port it picks, the guard on a
// non-loopback host, and the shutdown on a signal. The server and the
// browser are stubbed, except in the last test, which starts the real API.

import { type Server, createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Io } from './io.ts';
import { main } from './main.ts';
import {
  DEFAULT_PORT,
  type ServeRuntime,
  firstFreePort,
  isLoopback,
} from './serve.ts';
import { useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: { PORT: { type: 'port', default: 3000 } },
  files: [{ path: '.env', policy: 'merge', variables: '*' }],
};

interface Started {
  host?: string;
  port: number;
  root: string;
  schemaPath: string;
  token: string;
  staticDir?: string;
  version?: string;
}

/**
 * A stubbed runtime: `start` records its options and pretends to listen,
 * `stop` resolves the pending signal, `opened` holds the browser URLs.
 */
function fakeRuntime(
  options: {
    /** Fails the first starts with this error code. */
    failWith?: string[];
    /** Resolves the signal before the server has started. */
    signalEarly?: NodeJS.Signals;
  } = {},
) {
  const started: Started[] = [];
  const opened: string[] = [];
  let closed = 0;
  let stop: (signal: NodeJS.Signals) => void = () => {};
  const failures = [...(options.failWith ?? [])];
  const signal = new Promise<NodeJS.Signals>((resolve) => {
    stop = resolve;
  });
  let ready: () => void = () => {};
  const listening = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const runtime: ServeRuntime = {
    async start(opts) {
      if (options.signalEarly) stop(options.signalEarly);
      const failure = failures.shift();
      if (failure)
        throw Object.assign(new Error(`listen ${failure}`), { code: failure });
      started.push(opts as Started);
      const host = opts.host ?? '127.0.0.1';
      const port = opts.port === 0 ? 50_123 : opts.port;
      const url = `http://${host}:${port}`;
      // Listening, as the command sees it once its own microtasks have run.
      setImmediate(ready);
      return {
        host,
        port,
        url,
        launchUrl: `${url}/launch?token=${opts.token}`,
        close: async () => {
          closed += 1;
        },
      };
    },
    waitForSignal: () => signal,
    openBrowser: (url) => opened.push(url),
  };
  return {
    runtime,
    started,
    opened,
    listening,
    stop: (s: NodeJS.Signals = 'SIGINT') => stop(s),
    closed: () => closed,
  };
}

interface Result {
  code: number;
  out: string[];
  err: string[];
}

/** Runs `configure-env serve ...args`; `afterStart` runs once it listens. */
async function serve(
  args: string[],
  {
    cwd,
    runtime,
    isTTY = false,
    afterStart,
  }: {
    cwd: string;
    runtime: ReturnType<typeof fakeRuntime>;
    isTTY?: boolean;
    afterStart?: () => void | Promise<void>;
  },
): Promise<Result> {
  const result: Result = { code: -1, out: [], err: [] };
  const io: Io = {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env: {},
    isTTY,
    cwd,
    serve: runtime.runtime,
  };
  const running = main(['serve', ...args], io);
  void runtime.listening.then(async () => {
    await afterStart?.();
    runtime.stop();
  });
  result.code = await running;
  return result;
}

const project = useProject(SCHEMA);

describe('serve options', () => {
  it('prints its help', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--help'], { cwd: project.root, runtime });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toMatch(/^Usage: configure-env serve/);
    expect(runtime.started).toEqual([]);
  });

  it.each([
    [['--port', 'http']],
    [['--port', '65536']],
    [['--port', '-1']],
    [['--port', '80.5']],
    [['--open', '--no-open']],
    [['--host', '']],
    [['extra']],
  ])('refuses %j as a usage error', async (args) => {
    const runtime = fakeRuntime();
    const result = await serve(args, { cwd: project.root, runtime });
    expect(result.code).toBe(2);
    expect(runtime.started).toEqual([]);
  });

  it('refuses a missing schema with the init hint', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--schema', 'missing.json'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/no schema at .*missing\.json/);
    expect(runtime.started).toEqual([]);
  });

  it('serves the --root and --schema it is given', async () => {
    const runtime = fakeRuntime();
    const result = await serve(
      ['--root', project.root, '--schema', `${project.root}/env.schema.json`],
      { cwd: '/', runtime },
    );
    expect(result.code).toBe(0);
    expect(runtime.started[0]).toMatchObject({
      root: project.root,
      schemaPath: 'env.schema.json',
    });
  });

  it('starts with a fresh random token and the package version', async () => {
    const one = fakeRuntime();
    const two = fakeRuntime();
    await serve([], { cwd: project.root, runtime: one });
    await serve([], { cwd: project.root, runtime: two });
    const [a, b] = [one.started[0]!, two.started[0]!];
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(a.token).not.toBe(b.token);
    expect(a.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('passes an explicit --port through, 0 included', async () => {
    for (const port of ['5050', '0']) {
      const runtime = fakeRuntime();
      const result = await serve(['--port', port], {
        cwd: project.root,
        runtime,
      });
      expect(result.code).toBe(0);
      expect(runtime.started[0]!.port).toBe(Number(port));
    }
  });
});

describe('the port', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((s) => new Promise((done) => s.close(done))),
    );
  });

  /** Listens on `port` (0: any), returning the port taken. */
  const occupy = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = createNetServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        servers.push(server);
        resolve((server.address() as { port: number }).port);
      });
    });

  it('is the first free one from a start', async () => {
    const taken = await occupy(0);
    const free = await firstFreePort(taken, '127.0.0.1');
    expect(free).toBeGreaterThan(taken);
    await expect(firstFreePort(free, '127.0.0.1')).resolves.toBe(free);
  });

  it(`defaults to the first free port from ${DEFAULT_PORT}`, async () => {
    const runtime = fakeRuntime();
    const result = await serve([], { cwd: project.root, runtime });
    expect(result.code).toBe(0);
    expect(DEFAULT_PORT).toBe(4747);
    expect(runtime.started[0]!.port).toBeGreaterThanOrEqual(DEFAULT_PORT);
  });

  it('moves to the next port when the default one is taken meanwhile', async () => {
    const runtime = fakeRuntime({ failWith: ['EADDRINUSE'] });
    const result = await serve([], { cwd: project.root, runtime });
    expect(result.code).toBe(0);
    expect(runtime.started).toHaveLength(1);
    expect(runtime.started[0]!.port).toBeGreaterThan(DEFAULT_PORT);
  });

  it('fails when an explicit --port is taken', async () => {
    const runtime = fakeRuntime({ failWith: ['EADDRINUSE'] });
    const result = await serve(['--port', '5050'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/port 5050 is in use/);
    expect(runtime.started).toEqual([]);
  });
});

describe('the host', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', '::1', '::ffff:127.0.0.1'])(
    '%s is loopback',
    (host) => expect(isLoopback(host)).toBe(true),
  );

  it.each(['0.0.0.0', '::', '192.168.1.10', 'example.com', '128.0.0.1'])(
    '%s is not loopback',
    (host) => expect(isLoopback(host)).toBe(false),
  );

  it('defaults to 127.0.0.1', async () => {
    const runtime = fakeRuntime();
    await serve([], { cwd: project.root, runtime });
    expect(runtime.started[0]!.host).toBe('127.0.0.1');
  });

  it('refuses a non-loopback host without --unsafe-expose', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--host', '0.0.0.0'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/--unsafe-expose/);
    expect(runtime.started).toEqual([]);
  });

  it('binds a non-loopback host with --unsafe-expose, with a warning', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--host', '0.0.0.0', '--unsafe-expose'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]!.host).toBe('0.0.0.0');
    expect(result.err.join('\n')).toMatch(/warning: .*0\.0\.0\.0/i);
  });
});

describe('startup output', () => {
  it('prints a one-line banner and the token-bearing URL', async () => {
    const runtime = fakeRuntime();
    const result = await serve([], { cwd: project.root, runtime });
    const token = runtime.started[0]!.token;
    expect(result.out).toHaveLength(2);
    expect(result.out[0]).toMatch(
      /^configure-env serve .*http:\/\/127\.0\.0\.1:\d+/,
    );
    expect(result.out[1]).toContain(`/launch?token=${token}`);
  });

  it('prints {url, port, pid} with --json', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--json', '--port', '5050'], {
      cwd: project.root,
      runtime,
    });
    expect(result.out).toHaveLength(1);
    const document = JSON.parse(result.out[0]!) as Record<string, unknown>;
    expect(document).toMatchObject({
      command: 'serve',
      port: 5050,
      pid: process.pid,
    });
    expect(document.url).toBe(
      `http://127.0.0.1:5050/launch?token=${runtime.started[0]!.token}`,
    );
  });

  it.each([
    [true, [], true],
    [false, [], false],
    [false, ['--open'], true],
    [true, ['--no-open'], false],
    [true, ['--json'], false],
  ])('on a TTY=%s with %j opens the browser: %s', async (isTTY, args, open) => {
    const runtime = fakeRuntime();
    await serve(args, { cwd: project.root, runtime, isTTY });
    expect(runtime.opened).toEqual(
      open ? [expect.stringContaining('/launch?token=')] : [],
    );
  });
});

describe('shutdown', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'closes the server on %s and exits 0',
    async (signal) => {
      const runtime = fakeRuntime();
      const result = { code: -1 };
      const running = main(['serve'], {
        stdout: () => {},
        stderr: () => {},
        env: {},
        isTTY: false,
        cwd: project.root,
        serve: runtime.runtime,
      });
      await runtime.listening;
      expect(runtime.closed()).toBe(0);
      runtime.stop(signal);
      result.code = await running;
      expect(result.code).toBe(0);
      expect(runtime.closed()).toBe(1);
    },
  );

  it('exits 130 when cancelled before the server listens', async () => {
    const runtime = fakeRuntime({ signalEarly: 'SIGINT' });
    const err: string[] = [];
    const code = await main(['serve'], {
      stdout: () => {},
      stderr: (line) => err.push(line),
      env: {},
      isTTY: false,
      cwd: project.root,
      serve: runtime.runtime,
    });
    expect(code).toBe(130);
    expect(runtime.closed()).toBe(1);
  });
});

describe('the real server', () => {
  it('answers with the token, refuses without it, and stops on a signal', async () => {
    let stop: (signal: NodeJS.Signals) => void = () => {};
    const signal = new Promise<NodeJS.Signals>((resolve) => {
      stop = resolve;
    });
    const out: string[] = [];
    let printed: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      printed = resolve;
    });
    const running = main(['serve', '--json', '--port', '0'], {
      stdout: (line) => {
        out.push(line);
        printed();
      },
      stderr: () => {},
      env: {},
      isTTY: false,
      cwd: project.root,
      serve: { waitForSignal: () => signal, openBrowser: () => {} },
    });
    await Promise.race([ready, running]);
    const { url } = JSON.parse(out[0]!) as { url: string };
    const launch = new URL(url);
    const token = launch.searchParams.get('token')!;
    const health = await fetch(new URL('/api/health', launch), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);
    const denied = await fetch(new URL('/api/health', launch));
    expect(denied.status).toBe(401);
    stop('SIGTERM');
    await expect(running).resolves.toBe(0);
  }, 30_000);
});
