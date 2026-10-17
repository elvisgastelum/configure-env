// `configure-env serve`: its options, the port it picks, the guard on a
// non-loopback host, and the shutdown on a signal. The server and the
// browser are stubbed, except in the last test, which starts the real API.

import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type Server, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
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
  publicUrl?: string;
  tls?: { cert: Buffer; key: Buffer };
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
    env = {},
  }: {
    cwd: string;
    runtime: ReturnType<typeof fakeRuntime>;
    isTTY?: boolean;
    afterStart?: () => void | Promise<void>;
    env?: Record<string, string>;
  },
): Promise<Result> {
  const result: Result = { code: -1, out: [], err: [] };
  const io: Io = {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env,
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

  it('starts without a schema, so the portal can init one', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--schema', 'missing.json'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]).toMatchObject({
      root: project.root,
      schemaPath: 'missing.json',
    });
    expect(result.err.join('\n')).toMatch(
      /no schema at missing\.json yet: init one from the portal/,
    );
  });

  it('only takes a missing file for no schema', async () => {
    // A path through a file: stat fails with ENOTDIR, not ENOENT.
    await writeFile(join(project.root, 'notes'), 'not a directory\n');
    const runtime = fakeRuntime();
    const result = await serve(['--schema', 'notes/env.schema.json'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).not.toMatch(/init one from the portal/);
    expect(runtime.started).toEqual([]);
  });

  it('still refuses an invalid schema', async () => {
    await writeFile(join(project.root, 'bad.json'), '{"version": 2}\n');
    const runtime = fakeRuntime();
    const result = await serve(['--schema', 'bad.json'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/invalid schema .*bad\.json/);
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

describe('server.json', () => {
  const file = () => join(project.root, '.configure-env', 'server.json');
  const exists = () =>
    stat(file()).then(
      () => true,
      () => false,
    );
  /** The fake server listens before the command writes the file. */
  const written = async () => {
    while (!(await exists()))
      await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it('holds the url, pid, version and token while it runs, mode 600, and goes on stop', async () => {
    const runtime = fakeRuntime();
    let seen: { content: unknown; mode: number } | undefined;
    const result = await serve(['--port', '5050'], {
      cwd: project.root,
      runtime,
      afterStart: async () => {
        await written();
        seen = {
          content: JSON.parse(await readFile(file(), 'utf8')),
          mode: (await stat(file())).mode & 0o777,
        };
      },
    });
    expect(result.code).toBe(0);
    expect(seen).toEqual({
      content: {
        url: 'http://127.0.0.1:5050',
        pid: process.pid,
        version: runtime.started[0]!.version,
        token: runtime.started[0]!.token,
      },
      mode: 0o600,
    });
    expect(await exists()).toBe(false);
    // The output never holds it.
    expect(result.out.join('\n')).not.toContain('server.json');
  });

  it('keeps one another serve wrote since', async () => {
    const runtime = fakeRuntime();
    const other = JSON.stringify({ url: 'http://127.0.0.1:6000', pid: 1 });
    await serve(['--port', '5050'], {
      cwd: project.root,
      runtime,
      afterStart: async () => {
        await written();
        await writeFile(file(), other);
      },
    });
    expect(await readFile(file(), 'utf8')).toBe(other);
  });

  it('is never written by a run cancelled before it listens', async () => {
    const runtime = fakeRuntime({ signalEarly: 'SIGINT' });
    const code = await main(['serve'], {
      stdout: () => {},
      stderr: () => {},
      env: {},
      isTTY: false,
      cwd: project.root,
      serve: runtime.runtime,
    });
    expect(code).toBe(130);
    expect(await exists()).toBe(false);
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

  it('starts without a schema and writes the one init writes on POST /api/schema/init', async () => {
    const example = '# Where to listen.\nPORT=8080\nDEBUG=true\n';
    const [served, inited] = await Promise.all([
      mkdtemp(join(tmpdir(), 'configure-env-serve-init-')),
      mkdtemp(join(tmpdir(), 'configure-env-cli-init-')),
    ]);
    try {
      await writeFile(join(served, '.env.example'), example);
      await writeFile(join(inited, '.env.example'), example);
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
        cwd: served,
        serve: { waitForSignal: () => signal, openBrowser: () => {} },
      });
      await Promise.race([ready, running]);
      const launch = new URL((JSON.parse(out[0]!) as { url: string }).url);
      const headers = {
        authorization: `Bearer ${launch.searchParams.get('token')!}`,
        'content-type': 'application/json',
      };
      const before = await fetch(new URL('/api/schema', launch), { headers });
      expect(await before.json()).toMatchObject({ valid: false });
      const denied = await fetch(new URL('/api/schema/init', launch), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(denied.status).toBe(401);
      const written = await fetch(new URL('/api/schema/init', launch), {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(written.status).toBe(200);
      const again = await fetch(new URL('/api/schema/init', launch), {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(again.status).toBe(409);
      stop('SIGTERM');
      await expect(running).resolves.toBe(0);

      const code = await main(['init', '--ci'], {
        stdout: () => {},
        stderr: () => {},
        env: {},
        isTTY: false,
        cwd: inited,
      });
      expect(code).toBe(0);
      for (const file of ['env.schema.json', '.gitignore'])
        expect(await readFile(join(served, file), 'utf8')).toBe(
          await readFile(join(inited, file), 'utf8'),
        );
    } finally {
      await Promise.all(
        [served, inited].map((dir) =>
          rm(dir, { recursive: true, force: true }),
        ),
      );
    }
  }, 30_000);
});

const TOKEN = 'a-persistent-token-0123456789abcdefghij';

/** A fresh directory outside the project, removed after the test. */
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'configure-env-serve-remote-'));
  scratch.push(dir);
  return dir;
}

describe('a persistent token', () => {
  it('creates a missing --token-file with mode 600 and never prints the token', async () => {
    const dir = await scratchDir();
    const file = join(dir, 'token');
    const runtime = fakeRuntime();
    const result = await serve(['--token-file', file], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(0);
    const token = runtime.started[0]!.token;
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await readFile(file, 'utf8')).trim()).toBe(token);
    if (process.platform !== 'win32')
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    const printed = [...result.out, ...result.err].join('\n');
    expect(printed).not.toContain(token);
    expect(result.err.join('\n')).toContain(`created ${file}`);
    expect(result.out[1]).toBe(
      `Open http://127.0.0.1:${runtime.started[0]!.port}/launch?token=<token>, where <token> is the one in ${file}`,
    );
  });

  it('keeps the token of an existing --token-file across runs', async () => {
    const dir = await scratchDir();
    const file = join(dir, 'token');
    const first = fakeRuntime();
    await serve(['--token-file', file], { cwd: project.root, runtime: first });
    const second = fakeRuntime();
    const result = await serve(['--token-file', file], {
      cwd: project.root,
      runtime: second,
    });
    expect(result.code).toBe(0);
    expect(second.started[0]!.token).toBe(first.started[0]!.token);
    expect(result.err.join('\n')).not.toContain('created');
  });

  it('reads the token a --token-file holds, its trailing newline aside', async () => {
    const dir = await scratchDir();
    const file = join(dir, 'token');
    await writeFile(file, `${TOKEN}\n`, { mode: 0o600 });
    const runtime = fakeRuntime();
    const result = await serve(['--token-file', file], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]!.token).toBe(TOKEN);
    expect([...result.out, ...result.err].join('\n')).not.toContain(TOKEN);
  });

  it.skipIf(process.platform === 'win32')(
    'warns when a --token-file others can read',
    async () => {
      const dir = await scratchDir();
      const file = join(dir, 'token');
      await writeFile(file, TOKEN);
      await chmod(file, 0o644);
      const runtime = fakeRuntime();
      const result = await serve(['--token-file', file], {
        cwd: project.root,
        runtime,
      });
      expect(result.code).toBe(0);
      expect(result.err.join('\n')).toMatch(
        /warning: .*token.* mode 644.*chmod 600/,
      );
    },
  );

  it('takes CONFIGURE_ENV_TOKEN and never prints it', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--json'], {
      cwd: project.root,
      runtime,
      env: { CONFIGURE_ENV_TOKEN: TOKEN },
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]!.token).toBe(TOKEN);
    expect([...result.out, ...result.err].join('\n')).not.toContain(TOKEN);
    expect(JSON.parse(result.out[0]!)).toEqual({
      command: 'serve',
      url: `http://127.0.0.1:${runtime.started[0]!.port}`,
      port: runtime.started[0]!.port,
      pid: process.pid,
      token: 'CONFIGURE_ENV_TOKEN',
    });
  });

  it('reports the --token-file in --json in place of the launch URL', async () => {
    const dir = await scratchDir();
    const file = join(dir, 'token');
    await writeFile(file, TOKEN, { mode: 0o600 });
    const runtime = fakeRuntime();
    const result = await serve(['--json', '--token-file', file], {
      cwd: project.root,
      runtime,
    });
    const document = JSON.parse(result.out[0]!) as Record<string, unknown>;
    expect(document.url).toBe(`http://127.0.0.1:${runtime.started[0]!.port}`);
    expect(document.token).toBe(file);
  });

  it('ignores an empty CONFIGURE_ENV_TOKEN: a per-run token', async () => {
    const runtime = fakeRuntime();
    const result = await serve([], {
      cwd: project.root,
      runtime,
      env: { CONFIGURE_ENV_TOKEN: '' },
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]!.token).toMatch(/^[\w-]{43}$/);
    expect(result.out[1]).toContain(
      `/launch?token=${runtime.started[0]!.token}`,
    );
  });

  it.each([
    ['CONFIGURE_ENV_TOKEN', { CONFIGURE_ENV_TOKEN: 'short-token' }, false],
    ['--token-file', {}, true],
  ])(
    'refuses a token under 32 characters from %s (exit 2), unprinted',
    async (_source, env, viaFile) => {
      const args: string[] = [];
      if (viaFile) {
        const file = join(await scratchDir(), 'token');
        await writeFile(file, 'short-token\n', { mode: 0o600 });
        args.push('--token-file', file);
      }
      const runtime = fakeRuntime();
      const result = await serve(args, { cwd: project.root, runtime, env });
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toMatch(/at least 32 characters/);
      expect(result.err.join('\n')).not.toContain('short-token');
      expect(runtime.started).toEqual([]);
    },
  );

  it('refuses --token-file together with CONFIGURE_ENV_TOKEN (exit 2)', async () => {
    const file = join(await scratchDir(), 'token');
    const runtime = fakeRuntime();
    const result = await serve(['--token-file', file], {
      cwd: project.root,
      runtime,
      env: { CONFIGURE_ENV_TOKEN: TOKEN },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(
      /--token-file and CONFIGURE_ENV_TOKEN exclude each other/,
    );
    expect(runtime.started).toEqual([]);
  });

  it('fails when the --token-file folder does not exist (exit 1)', async () => {
    const file = join(await scratchDir(), 'missing', 'token');
    const runtime = fakeRuntime();
    const result = await serve(['--token-file', file], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/cannot create the token file/);
    expect(runtime.started).toEqual([]);
  });
});

describe('a public URL', () => {
  it('is passed to the server, which reports it', async () => {
    const runtime = fakeRuntime();
    const result = await serve(['--public-url', 'https://env.example.com'], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(0);
    expect(runtime.started[0]!.publicUrl).toBe('https://env.example.com');
  });

  it('is not passed when not given', async () => {
    const runtime = fakeRuntime();
    await serve([], { cwd: project.root, runtime });
    expect(runtime.started[0]).not.toHaveProperty('publicUrl');
    expect(runtime.started[0]).not.toHaveProperty('tls');
  });

  it.each([
    'env.example.com',
    'ftp://env.example.com',
    'https://env.example.com/portal',
    'https://user:pw@env.example.com',
  ])('refuses --public-url %s as a usage error', async (url) => {
    const runtime = fakeRuntime();
    const result = await serve(['--public-url', url], {
      cwd: project.root,
      runtime,
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/--public-url/);
    expect(runtime.started).toEqual([]);
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

/** A self-signed certificate for 127.0.0.1, made with openssl in `dir`. */
function testCertificate(dir: string) {
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
  return { cert, key };
}

describe('TLS', () => {
  it.each([[['--tls-cert', 'cert.pem']], [['--tls-key', 'key.pem']]])(
    'refuses %j alone as a usage error',
    async (args) => {
      const runtime = fakeRuntime();
      const result = await serve(args, { cwd: project.root, runtime });
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toMatch(/--tls-cert and --tls-key/);
      expect(runtime.started).toEqual([]);
    },
  );

  it('fails on a certificate it cannot read (exit 1)', async () => {
    const dir = await scratchDir();
    const runtime = fakeRuntime();
    const result = await serve(
      ['--tls-cert', join(dir, 'none.pem'), '--tls-key', join(dir, 'k.pem')],
      { cwd: project.root, runtime },
    );
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/cannot read --tls-cert/);
    expect(runtime.started).toEqual([]);
  });

  it('fails on files that are no certificate and key (exit 1)', async () => {
    const dir = await scratchDir();
    await writeFile(join(dir, 'cert.pem'), 'not a certificate\n');
    await writeFile(join(dir, 'key.pem'), 'not a key\n');
    const runtime = fakeRuntime();
    const result = await serve(
      ['--tls-cert', join(dir, 'cert.pem'), '--tls-key', join(dir, 'key.pem')],
      { cwd: project.root, runtime },
    );
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/not a usable certificate and key/);
    expect(runtime.started).toEqual([]);
  });

  it.skipIf(!hasOpenssl)(
    'binds a non-loopback host without --unsafe-expose and without the plain-HTTP warning',
    async () => {
      const { cert, key } = testCertificate(await scratchDir());
      const runtime = fakeRuntime();
      const result = await serve(
        ['--host', '0.0.0.0', '--tls-cert', cert, '--tls-key', key],
        { cwd: project.root, runtime },
      );
      expect(result.code).toBe(0);
      expect(runtime.started[0]!.host).toBe('0.0.0.0');
      expect(runtime.started[0]!.tls!.cert).toEqual(await readFile(cert));
      expect(runtime.started[0]!.tls!.key).toEqual(await readFile(key));
      expect(result.err.join('\n')).not.toMatch(/warning/);
    },
  );

  it('still refuses a non-loopback host without TLS, a token file and public URL notwithstanding', async () => {
    const file = join(await scratchDir(), 'token');
    const runtime = fakeRuntime();
    const result = await serve(
      [
        '--host',
        '0.0.0.0',
        '--token-file',
        file,
        '--public-url',
        'https://env.example.com',
      ],
      { cwd: project.root, runtime },
    );
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/--unsafe-expose/);
    expect(runtime.started).toEqual([]);
  });
});

/** GET over HTTPS, trusting `ca`. */
function httpsGet(url: string, ca: Buffer, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = httpsRequest(url, { ca, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Runs the real `serve` until `body` is done with its first stdout line. */
async function realServe(
  args: string[],
  env: Record<string, string>,
  body: (line: string, err: string[]) => Promise<void>,
) {
  let stop: (signal: NodeJS.Signals) => void = () => {};
  const signal = new Promise<NodeJS.Signals>((resolve) => {
    stop = resolve;
  });
  const out: string[] = [];
  const err: string[] = [];
  let printed: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    printed = resolve;
  });
  const running = main(['serve', '--json', '--port', '0', ...args], {
    stdout: (line) => {
      out.push(line);
      printed();
    },
    stderr: (line) => err.push(line),
    env,
    isTTY: false,
    cwd: project.root,
    serve: { waitForSignal: () => signal, openBrowser: () => {} },
  });
  await Promise.race([ready, running]);
  try {
    await body(out[0]!, err);
  } finally {
    stop('SIGTERM');
  }
  await expect(running).resolves.toBe(0);
  return { out, err };
}

describe('the real server, remote-ready', () => {
  it('answers the bearer token of a --token-file', async () => {
    const file = join(await scratchDir(), 'token');
    await writeFile(file, TOKEN, { mode: 0o600 });
    const { out, err } = await realServe(
      ['--token-file', file],
      {},
      async (line) => {
        const { url } = JSON.parse(line) as { url: string };
        const ok = await fetch(new URL('/api/health', url), {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(ok.status).toBe(200);
        const wrong = await fetch(new URL('/api/health', url), {
          headers: { authorization: `Bearer ${TOKEN}x` },
        });
        expect(wrong.status).toBe(401);
      },
    );
    expect([...out, ...err].join('\n')).not.toContain(TOKEN);
  }, 30_000);

  it('answers the bearer token of CONFIGURE_ENV_TOKEN', async () => {
    await realServe([], { CONFIGURE_ENV_TOKEN: TOKEN }, async (line) => {
      const { url } = JSON.parse(line) as { url: string };
      const ok = await fetch(new URL('/api/health', url), {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(ok.status).toBe(200);
    });
  }, 30_000);

  it('accepts the --public-url host and refuses an unknown one', async () => {
    await realServe(
      ['--public-url', 'https://env.example.com'],
      { CONFIGURE_ENV_TOKEN: TOKEN },
      async (line) => {
        const { url, port } = JSON.parse(line) as {
          url: string;
          port: number;
        };
        expect(url).toBe('https://env.example.com');
        const get = (host: string) =>
          new Promise<number>((resolve, reject) => {
            const req = httpRequest(
              {
                host: '127.0.0.1',
                port,
                path: '/api/health',
                headers: { host, authorization: `Bearer ${TOKEN}` },
              },
              (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode ?? 0));
              },
            );
            req.on('error', reject);
            req.end();
          });
        expect(await get('env.example.com')).toBe(200);
        expect(await get('evil.example.com')).toBe(403);
      },
    );
  }, 30_000);

  it.skipIf(!hasOpenssl)(
    'serves HTTPS with --tls-cert and --tls-key',
    async () => {
      const { cert, key } = testCertificate(await scratchDir());
      const ca = await readFile(cert);
      await realServe(
        ['--tls-cert', cert, '--tls-key', key],
        { CONFIGURE_ENV_TOKEN: TOKEN },
        async (line) => {
          const { url } = JSON.parse(line) as { url: string };
          expect(url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
          expect(
            await httpsGet(`${url}/api/health`, ca, {
              authorization: `Bearer ${TOKEN}`,
            }),
          ).toBe(200);
          expect(await httpsGet(`${url}/api/health`, ca, {})).toBe(401);
        },
      );
    },
    30_000,
  );
});
