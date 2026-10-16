// `serve --json` prints one line on stdout, whatever POST /api/open-in-editor
// does: the real launcher runs in a child process with a fake environment
// (a `ps` that lists no running IDE, and editors that are missing or are a
// script that prints), so no real editor ever starts.

import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { useProject } from './test-helpers.ts';

const ENTRY = fileURLToPath(new URL('../cli.ts', import.meta.url));
// The API's Nest decorators are TypeScript's legacy ones: tsx reads them
// from the API's tsconfig, not from the project the child runs in.
const TSCONFIG = fileURLToPath(
  new URL('../../../../apps/api/tsconfig.json', import.meta.url),
);
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
/** Each test starts the real server in a child process. */
const TIMEOUT = 30_000;

const dirs = useProject({
  version: 1,
  variables: { PORT: { type: 'port', default: 3000 } },
  files: [{ path: '.env', policy: 'merge', variables: '*' }],
});

let child: ChildProcess | undefined;
afterEach(() => {
  child?.kill('SIGKILL');
  child = undefined;
});

/** A directory of executable scripts, put first on the PATH. */
async function bin(scripts: Record<string, string>) {
  const dir = join(dirs.root, '.bin');
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    await writeFile(join(dir, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(dir, name), 0o755);
  }
  return dir;
}

/**
 * Runs `serve --json` with `env` over the editor variables, asks it to open
 * `.env` at PORT, then stops it; returns the answer and everything printed.
 */
async function openThroughServe(env: Record<string, string>) {
  await writeFile(join(dirs.root, '.env'), '# local\nPORT=8080\n');
  // Not one running IDE, whatever this machine runs.
  const fakes = await bin({ ps: 'exit 0' });
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakes}:${process.env.PATH}`,
    TSX_TSCONFIG_PATH: TSCONFIG,
  };
  for (const name of ['LAUNCH_EDITOR', 'VISUAL', 'EDITOR', 'INIT_CWD'])
    delete childEnv[name];
  Object.assign(childEnv, env);
  const started = spawn(
    process.execPath,
    ['--import', TSX, ENTRY, 'serve', '--json', '--no-open', '--port', '0'],
    { cwd: dirs.root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child = started;
  let out = '';
  let err = '';
  started.stderr!.on('data', (chunk: Buffer) => (err += chunk));
  const firstLine = new Promise<string>((resolve, reject) => {
    started.stdout!.on('data', (chunk: Buffer) => {
      out += chunk;
      if (out.includes('\n')) resolve(out.slice(0, out.indexOf('\n')));
    });
    started.on('exit', (code) =>
      reject(new Error(`serve exited with ${code}: ${err}`)),
    );
  });
  const { url } = JSON.parse(await firstLine) as { url: string };
  const launch = new URL(url);
  const token = launch.searchParams.get('token')!;
  const response = await fetch(new URL('/api/open-in-editor', launch.origin), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: '.env', key: 'PORT' }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  // Long enough for an editor that fails late, or prints, to be seen.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const exited = new Promise((resolve) => started.on('close', resolve));
  started.kill('SIGTERM');
  await exited;
  return { status: response.status, body, out, err };
}

/** stdout holds exactly the one JSON line `serve --json` documents. */
function expectOneJsonLine(out: string) {
  const lines = out.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe('');
  expect(JSON.parse(lines[0]!)).toMatchObject({ command: 'serve' });
}

describe.skipIf(process.platform === 'win32')(
  'serve --json with open-in-editor',
  () => {
    it(
      'keeps stdout to one line when no editor is found',
      async () => {
        const { status, body, out } = await openThroughServe({});
        expect(status).toBe(200);
        expect(body).toMatchObject({
          opened: false,
          reason: 'no-editor',
          file: '.env',
          line: 2,
        });
        expectOneJsonLine(out);
      },
      TIMEOUT,
    );

    it(
      'keeps stdout to one line when the editor command fails',
      async () => {
        const { status, body, out } = await openThroughServe({
          LAUNCH_EDITOR: join(dirs.root, 'no-such-editor'),
        });
        expect(status).toBe(200);
        expect(body).toMatchObject({ opened: false, reason: 'failed' });
        expectOneJsonLine(out);
      },
      TIMEOUT,
    );

    it(
      "sends what the editor prints to stderr, and opens the file at the key's line",
      async () => {
        const fakes = await bin({
          'fake-editor': `echo "editor says hello"\nprintf '%s\\n' "$@" > "${join(dirs.root, 'args.txt')}"`,
        });
        const { status, body, out, err } = await openThroughServe({
          LAUNCH_EDITOR: join(fakes, 'fake-editor'),
        });
        expect(status).toBe(200);
        expect(body).toMatchObject({ opened: true, line: 2, column: 1 });
        expectOneJsonLine(out);
        expect(err).toContain('editor says hello');
        const args = await readFile(join(dirs.root, 'args.txt'), 'utf8');
        // A $LAUNCH_EDITOR script takes the file, the line and the column.
        expect(args).toBe(`${join(await realpath(dirs.root), '.env')}\n2\n1\n`);
      },
      TIMEOUT,
    );
  },
);
