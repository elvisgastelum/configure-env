// Starts the real `configure-env serve --json` from source on a copy of a
// fixture project, the way packages/cli/src/cli/serve-editor.e2e.test.ts
// does: node --import tsx, the API's tsconfig for its legacy decorators, the
// project as the working directory and a free port.

import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repository root. */
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The CLI's entry, run from source. */
const ENTRY = join(REPO, 'packages/cli/src/cli.ts');
// The API's Nest decorators are TypeScript's legacy ones: tsx reads them
// from the API's tsconfig, not from the project the child runs in.
const TSCONFIG = join(REPO, 'apps/api/tsconfig.json');
// tsx as the CLI package itself resolves it, so the version never drifts.
const TSX = pathToFileURL(
  createRequire(join(REPO, 'packages/cli/package.json')).resolve('tsx'),
).href;

export type FixtureName = 'portfolio' | 'empty';

/** A running `configure-env serve` over a fresh copy of a fixture. */
export interface Served {
  /** The project directory: a temporary copy, never in the worktree. */
  dir: string;
  /** The launch URL serve printed, holding the token. */
  launchUrl: string;
  /** The server's origin, like http://127.0.0.1:51234. */
  origin: string;
  token: string;
  /** Everything serve printed on stderr so far. */
  stderr: () => string;
  stop: () => Promise<void>;
}

/** A value that looks like nothing a secret scanner knows, built per run. */
export const fakeSecret = () => `fake-${randomBytes(12).toString('hex')}`;

/**
 * The env files of each fixture that are not committed: `.env` files are
 * ignored by git, and the secret must not be a committed literal.
 */
const GENERATED: Record<FixtureName, () => Record<string, string>> = {
  portfolio: () => ({
    // VITE_CONTACT_WHATSAPP breaks its pattern, so check reports it.
    '.env': [
      '# The local copy, never committed.',
      'WEB_HOST=127.0.0.1',
      'WEB_PORT=8080',
      'VITE_CONTACT_EMAIL=hello@example.com',
      'VITE_CONTACT_WHATSAPP=call-me',
      `CONTACT_API_TOKEN=${fakeSecret()}`,
      '',
    ].join('\n'),
  }),
  empty: () => ({}),
};

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Copies a fixture into a new temporary directory and writes its env files. */
export async function copyFixture(name: FixtureName): Promise<string> {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), `configure-env-e2e-${name}-`)),
  );
  await cp(join(FIXTURES, name), dir, { recursive: true });
  for (const [path, text] of Object.entries(GENERATED[name]()))
    await writeFile(join(dir, path), text, { mode: 0o600 });
  return dir;
}

/** How long serve may take to print its line: tsx compiles the API first. */
const START_TIMEOUT = 60_000;

/** Starts serve in `dir` and waits for its one JSON line on stdout. */
export async function startServe(dir: string): Promise<Served> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: TSCONFIG,
  };
  // No editor ever opens, and INIT_CWD (set by pnpm) must not move the root.
  for (const name of ['LAUNCH_EDITOR', 'VISUAL', 'EDITOR', 'INIT_CWD'])
    delete env[name];
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', TSX, ENTRY, 'serve', '--json', '--no-open', '--port', '0'],
    { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  let err = '';
  child.stderr!.on('data', (chunk: Buffer) => (err += chunk));
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  const line = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`serve printed nothing in time: ${err}`)),
      START_TIMEOUT,
    );
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      resolve(out.slice(0, out.indexOf('\n')));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited with ${code}: ${err}`));
    });
  }).catch((error: unknown) => {
    child.kill('SIGKILL');
    throw error;
  });
  const printed = JSON.parse(line) as {
    command: string;
    url: string;
    port: number;
    pid: number;
  };
  const launch = new URL(printed.url);
  return {
    dir,
    launchUrl: printed.url,
    origin: launch.origin,
    token: launch.searchParams.get('token') ?? '',
    stderr: () => err,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 10_000).unref(),
      );
      if ((await Promise.race([exited, timeout])) === 'timeout') {
        child.kill('SIGKILL');
        await exited;
      }
    },
  };
}

/** Removes a fixture copy. */
export const removeFixture = (dir: string) =>
  rm(dir, { recursive: true, force: true });

/**
 * Stores `served` as environment `name` of the project in `dir`, as
 * `configure-env env add` does: .configure-env/environments.json, mode 600.
 */
export async function addEnvironment(
  dir: string,
  name: string,
  served: Pick<Served, 'origin' | 'token'>,
  others: Record<string, { url: string; token: string }> = {},
) {
  await mkdir(join(dir, '.configure-env'), { recursive: true });
  await writeFile(
    join(dir, '.configure-env', 'environments.json'),
    `${JSON.stringify(
      {
        version: 1,
        environments: {
          ...others,
          [name]: { url: served.origin, token: served.token },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}
