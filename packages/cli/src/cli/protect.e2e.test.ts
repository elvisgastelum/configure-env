// The state lock through the real entry point: a run that waits for another
// run's lock must stay alive, then record the fingerprint.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { useProject } from './test-helpers.ts';

const ENTRY = fileURLToPath(new URL('../cli.ts', import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const dirs = useProject({
  version: 1,
  variables: { KEY: { type: 'string', secret: true, protected: true } },
  files: [{ path: '.env', policy: 'merge', mode: '600', variables: '*' }],
});

it('waits for a held lock, then records the fingerprint', async () => {
  const state = join(dirs.root, '.configure-env/state.json');
  await mkdir(join(dirs.root, '.configure-env'));
  await writeFile(`${state}.lock`, '');
  const env = { ...process.env };
  delete env.INIT_CWD;
  const child = spawn(
    process.execPath,
    [
      '--import',
      TSX,
      ENTRY,
      'set',
      '--ci',
      '--create',
      '--file',
      '.env',
      '--stdin',
      'KEY',
    ],
    { cwd: dirs.root, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let err = '';
  child.stderr.on('data', (chunk: Buffer) => (err += chunk));
  child.stdin.end('a-protected-value');
  const code = new Promise((resolve) => child.on('close', resolve));
  // Released while the child waits for it.
  setTimeout(() => void rm(`${state}.lock`), 300);
  expect({ code: await code, err }).toEqual({ code: 0, err: '' });
  const recorded = JSON.parse(await readFile(state, 'utf8'));
  expect(Object.keys(recorded.fingerprints['.env'])).toEqual(['KEY']);
}, 15_000);
