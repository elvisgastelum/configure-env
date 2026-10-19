// `configure-env serve`: starts the local API with the portal for the
// project, prints the token-bearing launch URL, and runs until SIGINT or
// SIGTERM. For a server other machines reach, the token can persist (a
// token file or CONFIGURE_ENV_TOKEN), and it serves HTTPS or names the
// public URL of the reverse proxy in front of it. The portal switches to
// the environments `env add` stored, through the server's gateway. With
// --advertise it announces itself on the local network over mDNS (see
// advertise.ts). The server (@configure-env/api, NestJS) is imported only
// here and only when the command runs, so no other command pays for
// loading it.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer, isIP } from 'node:net';
import { relative, resolve } from 'node:path';
import { createSecureContext } from 'node:tls';
import { fileURLToPath } from 'node:url';
import {
  type AdvertisedService,
  type Advertisement,
  MAX_NAME_BYTES,
  SERVICE_TYPE,
  advertisedService,
  bonjourAdvertiser,
  defaultServiceName,
} from './advertise.ts';
import {
  CliError,
  contextOf,
  displayPath,
  loadContextSchema,
  parseCommand,
  printWarnings,
  usageError,
} from './common.ts';
import { readEnvironments } from './environments.ts';
import { SERVE_HELP, VERSION } from './help.ts';
import type { Io } from './io.ts';
import { loadServer } from './load-server.js';
import { PACKAGE_ROOT } from './package-root.ts';
import { removeServerFile, writeServerFile } from './server-file.ts';

/** Where the search for a free port starts when --port is not given. */
export const DEFAULT_PORT = 4747;
export const DEFAULT_HOST = '127.0.0.1';
/** How many ports from the start the search tries. */
const PORT_SEARCH = 100;
/** How many times a start races another process for a free port. */
const START_ATTEMPTS = 5;
/** The shortest token the API takes. */
export const MIN_TOKEN_LENGTH = 32;
/** The environment variable that holds a persistent token. */
export const TOKEN_ENV = 'CONFIGURE_ENV_TOKEN';

/**
 * What `serve` passes to the API's createServer. Declared here,
 * not imported, so TypeScript never loads the API (see load-server.js).
 */
export interface ServerOptions {
  root: string;
  schemaPath: string;
  host?: string;
  port: number;
  token: string;
  staticDir?: string;
  version?: string;
  publicUrl?: string;
  tls?: { cert: Buffer; key: Buffer };
  /**
   * The environments `env add` stored, read on every request: the portal
   * switches to them, through the server's /env/<name>/api/ gateway.
   */
  environments?: () => Promise<Record<string, { url: string; token: string }>>;
}

/** The running server createServer resolves to. */
export interface ApiServer {
  host: string;
  port: number;
  url: string;
  launchUrl: string;
  close(): Promise<void>;
}

export type { AdvertisedService, Advertisement } from './advertise.ts';

/**
 * What `serve` touches outside the process: the server, signals, a
 * browser, the local network.
 */
export interface ServeRuntime {
  /** Starts the API; the default imports the API server lazily. */
  start(options: ServerOptions): Promise<ApiServer>;
  /**
   * Publishes the service over mDNS (--advertise); the default imports
   * bonjour-service lazily. `onError` hears of a later failure.
   */
  advertise(
    service: AdvertisedService,
    onError: (error: Error) => void,
  ): Promise<Advertisement>;
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
  'token-file': { type: 'string' },
  'public-url': { type: 'string' },
  'tls-cert': { type: 'string' },
  'tls-key': { type: 'string' },
  advertise: { type: 'boolean' },
  name: { type: 'string' },
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

/** Refuses a --public-url that is not an http(s) origin without a path. */
function checkPublicUrl(value: string): void {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw usageError(
      `--public-url takes an http or https origin without a path, such as https://env.example.com; got ${value}`,
    );
}

/** Where a persistent token comes from, as the output names it. */
type TokenSource =
  | { kind: 'run' }
  | { kind: 'env'; token: string }
  | { kind: 'file'; path: string; display: string };

/**
 * The token: CONFIGURE_ENV_TOKEN's, the --token-file's (written with a new
 * random one, mode 600, when missing), else a fresh one for this run. A
 * token is never printed, not even in an error.
 */
async function resolveToken(
  source: TokenSource,
  io: Io,
): Promise<{ token: string; name?: string }> {
  if (source.kind === 'run') return { token: newToken() };
  if (source.kind === 'env') {
    if (source.token.length < MIN_TOKEN_LENGTH)
      throw usageError(
        `${TOKEN_ENV} must be at least ${MIN_TOKEN_LENGTH} characters`,
      );
    return { token: source.token, name: TOKEN_ENV };
  }
  const { path, display } = source;
  let text: string | undefined;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      throw new CliError(1, [
        `cannot read the token file ${display}: ${errorCode(error) ?? (error as Error).message}`,
      ]);
  }
  if (text === undefined) {
    const token = newToken();
    try {
      await writeFile(path, `${token}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      throw new CliError(1, [
        `cannot create the token file ${display}: ${errorCode(error) ?? (error as Error).message}`,
      ]);
    }
    io.stderr(`configure-env: created ${display} with a new token (mode 600)`);
    return { token, name: display };
  }
  const token = text.trim();
  if (token.length < MIN_TOKEN_LENGTH)
    throw usageError(
      `the token in ${display} must be at least ${MIN_TOKEN_LENGTH} characters`,
    );
  if (process.platform !== 'win32') {
    const mode = (await stat(path)).mode & 0o777;
    if (mode & 0o077)
      io.stderr(
        `configure-env: warning: the token file ${display} has mode ${mode.toString(8)}: others on this machine can read it; chmod 600 it`,
      );
  }
  return { token, name: display };
}

const newToken = () => randomBytes(32).toString('base64url');

/** The --tls-cert and --tls-key files, checked to make a usable pair. */
async function readTls(
  certPath: string,
  keyPath: string,
  io: Io,
): Promise<{ cert: Buffer; key: Buffer }> {
  const read = async (option: string, path: string) => {
    try {
      return await readFile(resolve(io.cwd, path));
    } catch (error) {
      throw new CliError(1, [
        `cannot read ${option} ${path}: ${errorCode(error) ?? (error as Error).message}`,
      ]);
    }
  };
  const tls = {
    cert: await read('--tls-cert', certPath),
    key: await read('--tls-key', keyPath),
  };
  try {
    createSecureContext(tls);
  } catch (error) {
    throw new CliError(1, [
      `--tls-cert ${certPath} and --tls-key ${keyPath} are not a usable certificate and key: ${(error as Error).message}`,
    ]);
  }
  return tls;
}

/**
 * The portal's built files: dist/web in the package, apps/web/dist in the
 * checkout. Run from source (tsx), the checkout's build comes first: dist/web
 * is a copy the last `pnpm build` left, older than the portal being worked on.
 */
function portalDir(): string | undefined {
  const fromSource = import.meta.url.endsWith('.ts');
  const candidates = ['dist/web/', '../../apps/web/dist/'];
  if (fromSource) candidates.reverse();
  for (const candidate of candidates) {
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
    const { createServer } = await loadServer();
    return createServer(options);
  },
  advertise: bonjourAdvertiser(),
  waitForSignal: waitForProcessSignal,
  openBrowser: openInBrowser,
};

/** --name as the advertised name: --advertise's, at most 63 bytes. */
function parseName(
  value: string | undefined,
  advertise: boolean,
): string | undefined {
  if (value === undefined) return undefined;
  if (!advertise) throw usageError('--name goes with --advertise');
  if (!value.trim()) throw usageError('--name takes a name');
  if (Buffer.byteLength(value) > MAX_NAME_BYTES)
    throw usageError(
      `--name takes at most ${MAX_NAME_BYTES} bytes, got ${Buffer.byteLength(value)}`,
    );
  return value;
}

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
  const certPath = options['tls-cert'];
  const keyPath = options['tls-key'];
  if ((certPath === undefined) !== (keyPath === undefined))
    throw usageError('--tls-cert and --tls-key go together');
  const withTls = certPath !== undefined;
  const publicUrl = options['public-url'];
  if (publicUrl !== undefined) checkPublicUrl(publicUrl);
  const envToken = io.env[TOKEN_ENV] || undefined;
  const tokenFile = options['token-file'];
  if (tokenFile === '') throw usageError('--token-file takes a path');
  if (tokenFile !== undefined && envToken !== undefined)
    throw usageError(`--token-file and ${TOKEN_ENV} exclude each other`);
  const tokenSource: TokenSource =
    tokenFile !== undefined
      ? {
          kind: 'file',
          path: resolve(io.cwd, tokenFile),
          display: displayPath(io.cwd, resolve(io.cwd, tokenFile)),
        }
      : envToken !== undefined
        ? { kind: 'env', token: envToken }
        : { kind: 'run' };
  const advertise = options.advertise === true;
  const name = parseName(options.name, advertise);
  const exposed = !isLoopback(host);
  if (advertise && !exposed)
    throw usageError(
      `--advertise with --host ${host}: nothing on the LAN can reach a loopback server`,
      'pass a --host other machines reach, such as 0.0.0.0, with --tls-cert and --tls-key',
    );
  // Over HTTPS the token never crosses the network in the clear.
  if (exposed && !withTls && !options['unsafe-expose'])
    throw usageError(
      `--host ${host} is not a loopback address: the portal would be reachable from other machines`,
      'pass --unsafe-expose to bind it anyway',
    );

  const context = await contextOf(io, options);
  // A missing schema is no error here: the portal offers to init one. An
  // invalid one still is, as for every other command.
  const hasSchema = await stat(context.schemaPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== 'ENOENT',
  );
  if (hasSchema) await loadContextSchema(context);
  const tls = withTls ? await readTls(certPath, keyPath!, io) : undefined;
  const { token, name: tokenName } = await resolveToken(tokenSource, io);
  const runtime: ServeRuntime = { ...defaultRuntime, ...io.serve };
  if (exposed && !withTls)
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
      token,
      version: VERSION,
      environments: () => readEnvironments(context.root),
      ...(staticDir ? { staticDir } : {}),
      ...(publicUrl !== undefined ? { publicUrl } : {}),
      ...(tls ? { tls } : {}),
    },
    port,
  );
  // A signal that arrived while the server started cancels the run.
  const early = await Promise.race([signal, Promise.resolve(undefined)]);
  if (early) {
    await server.close();
    return 130;
  }
  const advertisement = advertise
    ? await publish(runtime, io, {
        port: server.port,
        name: name ?? defaultServiceName(),
        version: VERSION,
        ...(tls ? { cert: tls.cert } : {}),
      })
    : undefined;
  // The other commands of the project run through this server meanwhile.
  await writeServerFile(context.root, {
    url: server.url,
    pid: process.pid,
    version: VERSION,
    token,
  }).catch((error: NodeJS.ErrnoException) =>
    printWarnings(io, [
      `cannot write .configure-env/server.json: ${error.code ?? error.message}; other commands start a server of their own`,
    ]),
  );

  // A persistent token is never printed: the output names where it is.
  if (context.json) {
    io.stdout(
      JSON.stringify({
        command: 'serve',
        url: tokenName === undefined ? server.launchUrl : server.url,
        port: server.port,
        pid: process.pid,
        ...(tokenName === undefined ? {} : { token: tokenName }),
      }),
    );
  } else {
    io.stdout(
      `configure-env serve · ${displayPath(io.cwd, context.schemaPath)} on ${server.url} · Ctrl-C to stop`,
    );
    io.stdout(
      tokenName === undefined
        ? `Open ${server.launchUrl}`
        : `Open ${server.url}/launch?token=<token>, where <token> is the one in ${tokenName}`,
    );
  }
  if (!hasSchema)
    io.stderr(
      `configure-env: no schema at ${displayPath(io.cwd, context.schemaPath)} yet: init one from the portal, or run configure-env init`,
    );
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
  await advertisement?.stop().catch(() => undefined);
  await removeServerFile(context.root, process.pid).catch(() => undefined);
  await server.close();
  return 0;
}

/**
 * Advertises the server on the local network, saying so on stderr. A
 * failure is a warning: the server still serves, by its address.
 */
async function publish(
  runtime: ServeRuntime,
  io: Io,
  options: Parameters<typeof advertisedService>[0],
): Promise<Advertisement | undefined> {
  const warn = (error: Error) =>
    printWarnings(io, [
      `cannot advertise on the local network: ${error.message}`,
    ]);
  try {
    const service = advertisedService(options);
    const advertisement = await runtime.advertise(service, warn);
    io.stderr(
      `configure-env: advertised on the local network as "${service.name}" (_${SERVICE_TYPE}._${service.protocol})`,
    );
    if (service.txt.tls === '0')
      printWarnings(io, [
        'advertising a plain-HTTP server: anyone on the local network can find it, and the token crosses it in the clear',
      ]);
    return advertisement;
  } catch (error) {
    warn(error as Error);
    return undefined;
  }
}
