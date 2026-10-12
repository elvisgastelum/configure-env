// `configure-env serve`: starts the local API with the portal for the
// project, prints the token-bearing launch URL, and runs until SIGINT or
// SIGTERM. The server (@configure-env/api, NestJS) is imported only here and
// only when the command runs, so no other command pays for loading it.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createNetServer, isIP } from 'node:net';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiServer, ServerOptions } from '@configure-env/api';
import {
  CliError,
  contextOf,
  displayPath,
  loadContextSchema,
  parseCommand,
  usageError,
} from './common.ts';
import { SERVE_HELP, VERSION } from './help.ts';
import type { Io } from './io.ts';
import { PACKAGE_ROOT } from './package-root.ts';

/** Where the search for a free port starts when --port is not given. */
export const DEFAULT_PORT = 4747;
export const DEFAULT_HOST = '127.0.0.1';
/** How many ports from the start the search tries. */
const PORT_SEARCH = 100;
/** How many times a start races another process for a free port. */
const START_ATTEMPTS = 5;

/** What `serve` touches outside the process: the server, signals, a browser. */
export interface ServeRuntime {
  /** Starts the API; the default imports @configure-env/api lazily. */
  start(options: ServerOptions): Promise<ApiServer>;
  /** Resolves with the first SIGINT or SIGTERM. */
  waitForSignal(): Promise<NodeJS.Signals>;
  /** Opens a URL in the default browser, best effort. */
  openBrowser(url: string): void;
}

const OPTIONS = {
  port: { type: 'string' },
  host: { type: 'string' },
  open: { type: 'boolean' },
  'no-open': { type: 'boolean' },
  'unsafe-expose': { type: 'boolean' },
} as const;

/** Whether a host only ever reaches this machine. */
export function isLoopback(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (name === 'localhost' || name === '::1') return true;
  const v4 = name.startsWith('::ffff:') ? name.slice('::ffff:'.length) : name;
  return isIP(v4) === 4 && v4.startsWith('127.');
}

const errorCode = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code;

/** Whether `port` can be bound on `host` now; a taken port is false. */
function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', (error) => {
      const code = errorCode(error);
      if (code === 'EADDRINUSE' || code === 'EACCES') resolve(false);
      else reject(error);
    });
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/** The first port from `from` that `host` can bind, within the search range. */
export async function firstFreePort(
  from: number,
  host: string,
): Promise<number> {
  const last = Math.min(from + PORT_SEARCH - 1, 65_535);
  for (let port = from; port <= last; port += 1) {
    if (await canListen(port, host)) return port;
  }
  throw new CliError(1, [
    `no free port from ${from} to ${last} on ${host}`,
    'pass --port <port>, or --port 0 for any free one',
  ]);
}

/** --port as a number; undefined when absent. */
function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(port >= 0 && port <= 65_535))
    throw usageError(`--port takes a port from 0 to 65535, got ${value}`);
  return port;
}

/** The portal's built files: dist/web in the package, apps/web/dist in the checkout. */
function portalDir(): string | undefined {
  for (const candidate of ['dist/web/', '../../apps/web/dist/']) {
    const dir = new URL(candidate, PACKAGE_ROOT);
    if (existsSync(new URL('index.html', dir))) return fileURLToPath(dir);
  }
  return undefined;
}

function waitForProcessSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const signals = ['SIGINT', 'SIGTERM'] as const;
    const handlers = signals.map((signal) => {
      const handler = () => {
        // A second signal falls through to Node's default: an immediate exit.
        signals.forEach((s, i) => process.off(s, handlers[i]!));
        resolve(signal);
      };
      process.on(signal, handler);
      return handler;
    });
  });
}

function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser to open: the URL is printed anyway.
  }
}

const defaultRuntime: ServeRuntime = {
  async start(options) {
    const { createServer } = await import('@configure-env/api');
    return createServer(options);
  },
  waitForSignal: waitForProcessSignal,
  openBrowser: openInBrowser,
};

/**
 * Starts the server: on an explicit port or fails, else on the first free
 * port from DEFAULT_PORT, moving on when another process takes it first.
 */
async function listen(
  runtime: ServeRuntime,
  options: Omit<ServerOptions, 'port'> & { host: string },
  explicit: number | undefined,
): Promise<ApiServer> {
  if (explicit !== undefined) {
    try {
      return await runtime.start({ ...options, port: explicit });
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE') throw error;
      throw new CliError(1, [
        `port ${explicit} is in use`,
        'pass another --port, or none for the first free one',
      ]);
    }
  }
  let from = DEFAULT_PORT;
  for (let attempt = 1; ; attempt += 1) {
    const port = await firstFreePort(from, options.host);
    try {
      return await runtime.start({ ...options, port });
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE' || attempt >= START_ATTEMPTS)
        throw error;
      from = port + 1;
    }
  }
}

export async function serveCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(SERVE_HELP);
    return 0;
  }
  if (options.open && options['no-open'])
    throw usageError('--open and --no-open exclude each other');
  const host = options.host ?? DEFAULT_HOST;
  if (!host) throw usageError('--host takes an address');
  const port = parsePort(options.port);
  const exposed = !isLoopback(host);
  if (exposed && !options['unsafe-expose'])
    throw usageError(
      `--host ${host} is not a loopback address: the portal would be reachable from other machines`,
      'pass --unsafe-expose to bind it anyway',
    );

  const context = await contextOf(io, options);
  await loadContextSchema(context);
  const runtime: ServeRuntime = { ...defaultRuntime, ...io.serve };
  if (exposed)
    io.stderr(
      `configure-env: warning: serving on ${host}: anyone who can reach it and holds the token can read and change this project's env files`,
    );

  const signal = runtime.waitForSignal();
  const staticDir = portalDir();
  const server = await listen(
    runtime,
    {
      root: context.root,
      schemaPath: relative(context.root, context.schemaPath),
      host,
      token: randomBytes(32).toString('base64url'),
      version: VERSION,
      ...(staticDir ? { staticDir } : {}),
    },
    port,
  );
  // A signal that arrived while the server started cancels the run.
  const early = await Promise.race([signal, Promise.resolve(undefined)]);
  if (early) {
    await server.close();
    return 130;
  }

  if (context.json) {
    io.stdout(
      JSON.stringify({
        command: 'serve',
        url: server.launchUrl,
        port: server.port,
        pid: process.pid,
      }),
    );
  } else {
    io.stdout(
      `configure-env serve · ${displayPath(io.cwd, context.schemaPath)} on ${server.url} · Ctrl-C to stop`,
    );
    io.stdout(`Open ${server.launchUrl}`);
  }
  if (!staticDir)
    io.stderr(
      'configure-env: the portal is not built; serving the API only (run pnpm build)',
    );
  const open = options['no-open']
    ? false
    : (options.open ?? (io.isTTY && !context.json));
  if (open) runtime.openBrowser(server.launchUrl);

  const received = await signal;
  io.stderr(`configure-env: ${received}: stopping`);
  await server.close();
  return 0;
}
