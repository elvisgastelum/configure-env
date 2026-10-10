// `set --stdin` through the real entry point: process.stdin, wired by
// src/cli.ts, piped into a child process the way an agent runner does it.

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STDIN_MAX_BYTES } from './stdin.ts';
import { useProject } from './test-helpers.ts';

const ENTRY = fileURLToPath(new URL('../cli.ts', import.meta.url));
/** Each test spawns a process: allow far more than the default 5 s. */
const TIMEOUT = 10_000;
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const dirs = useProject({
  version: 1,
  variables: { TOKEN: { type: 'string', secret: true, minLength: 8 } },
  files: [{ path: 'app.env', policy: 'merge', mode: '600', variables: '*' }],
});

/**
 * Runs the CLI in the project with `input` piped to stdin, then closed, or
 * left open with `keepOpen`: a runner's pipe that never ends.
 */
function cli(args: string[], input: string, { keepOpen = false } = {}) {
  // INIT_CWD would point a pnpm-run test at the checkout; CI changes nothing
  // for set, but leave the child's environment to what this test chooses.
  const env = { ...process.env };
  delete env.INIT_CWD;
  const child = spawn(process.execPath, ['--import', TSX, ENTRY, ...args], {
    cwd: dirs.root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk));
  child.stderr.on('data', (chunk: Buffer) => (err += chunk));
  // The child may stop reading first: its end of the pipe closes, then.
  child.stdin.on('error', () => {});
  if (keepOpen) child.stdin.write(input);
  else child.stdin.end(input);
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        child.stdin.destroy();
        resolve({ code, out, err });
      });
    },
  );
}

describe('set --stdin through src/cli.ts', () => {
  it(
    'writes the piped value and masks it in the output',
    async () => {
      const r = await cli(
        ['set', '--create', '--stdin', 'TOKEN'],
        'piped-secret-value\n',
      );
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(r.out).toBe('TOKEN: added (••••ue)\n');
      expect(await readFile(join(dirs.root, 'app.env'), 'utf8')).toBe(
        'TOKEN=piped-secret-value\n',
      );
    },
    TIMEOUT,
  );

  it(
    'exits 1 and writes nothing for an empty stdin',
    async () => {
      await writeFile(join(dirs.root, 'app.env'), 'TOKEN=abcdefghij\n');
      const r = await cli(['set', '--stdin', 'TOKEN'], '');
      expect(r.code).toBe(1);
      expect(r.err).toBe(
        'configure-env: TOKEN: stdin was empty; nothing was written to app.env\n',
      );
      expect(await readFile(join(dirs.root, 'app.env'), 'utf8')).toBe(
        'TOKEN=abcdefghij\n',
      );
    },
    TIMEOUT,
  );

  // The size cap fails the read the same way the idle timeout does: the
  // stream is destroyed. With the pipe still open, only that lets the
  // process exit, so this proves it without waiting out the timeout.
  it(
    'exits on a read that fails while the pipe stays open',
    async () => {
      await writeFile(join(dirs.root, 'app.env'), 'TOKEN=abcdefghij\n');
      const r = await cli(
        ['set', '--stdin', 'TOKEN'],
        'x'.repeat(STDIN_MAX_BYTES + 1),
        { keepOpen: true },
      );
      expect(r.code).toBe(1);
      expect(r.err).toBe(
        `configure-env: --stdin takes at most ${STDIN_MAX_BYTES} bytes\n`,
      );
      expect(await readFile(join(dirs.root, 'app.env'), 'utf8')).toBe(
        'TOKEN=abcdefghij\n',
      );
    },
    TIMEOUT,
  );
});
