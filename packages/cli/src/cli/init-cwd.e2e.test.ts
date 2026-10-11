// `pnpm start` runs src/cli.ts inside packages/cli, but pnpm sets INIT_CWD to
// the directory the user ran pnpm from. Relative --schema and --root paths
// must resolve there, as the README's root-level example relies on.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, useProject } from './test-helpers.ts';

const ENTRY = fileURLToPath(new URL('../cli.ts', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../', import.meta.url));
/** Each test spawns a process: allow far more than the default 5 s. */
const TIMEOUT = 10_000;
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const dirs = useProject({
  version: 1,
  variables: { PORT: { type: 'port', default: 3000 } },
  files: [{ path: 'app.env', policy: 'merge', variables: '*' }],
});

/** Runs `command` and collects its exit code and combined output. */
function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk));
  return new Promise<{ code: number | null; out: string }>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, out }));
    },
  );
}

/** Runs the CLI from the package directory, as `pnpm start` does. */
function cli(args: string[], initCwd: string | undefined) {
  const env = { ...process.env };
  if (initCwd === undefined) delete env.INIT_CWD;
  else env.INIT_CWD = initCwd;
  return run(process.execPath, ['--import', TSX, ENTRY, ...args], PACKAGE, env);
}

const ARGS = ['check', '--ci', '--schema', 'env.schema.json', '--root', '.'];

describe('relative paths through src/cli.ts', () => {
  it(
    'resolve against INIT_CWD, not the package directory',
    async () => {
      const { code, out } = await cli(ARGS, dirs.root);
      // Drift (exit 1) on the project's missing app.env proves the schema
      // and root were found in INIT_CWD.
      expect(code).toBe(1);
      expect(out).toContain('app.env: missing');
    },
    TIMEOUT,
  );

  it(
    'fall back to the working directory without INIT_CWD',
    async () => {
      const { code, out } = await cli(ARGS, undefined);
      // packages/cli has no env.schema.json: a usage error naming it.
      expect(code).toBe(2);
      // The CLI names the real path of its working directory, which differs
      // from PACKAGE when the checkout sits behind a symlink.
      expect(out).toContain(
        `no schema at ${join(realpathSync(PACKAGE), 'env.schema.json')}`,
      );
    },
    TIMEOUT,
  );

  it('resolve against the repo root through the root `pnpm start` script', async () => {
    // The README's example: the root script hands off to the package with
    // `pnpm --filter`, and pnpm sets INIT_CWD to where it was run.
    const env = { ...process.env };
    delete env.INIT_CWD;
    const root = fileURLToPath(REPO_ROOT);
    // Paths relative to the repo root, as a user at the root would type them.
    const project = relative(realpathSync(root), realpathSync(dirs.root));
    const schema = join(project, 'env.schema.json');
    const { code, out } = await run(
      'pnpm',
      [
        '--silent',
        'start',
        '--',
        'check',
        '--ci',
        '--schema',
        schema,
        '--root',
        project,
      ],
      root,
      env,
    );
    expect(code).toBe(1);
    expect(out).toContain('app.env: missing');
  }, 30_000);
});
