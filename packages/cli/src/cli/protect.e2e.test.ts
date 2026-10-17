// The state's write transaction through the real entry point: a run that
// waits for another run's transaction must stay alive, then record the
// fingerprint.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vite-plus/test';
import { STATE, holdState, readState, useProject } from './test-helpers.ts';

const ENTRY = fileURLToPath(new URL('../cli.ts', import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
// set runs the API in-process, whose Nest decorators are TypeScript's
// legacy ones: tsx reads them from the API's tsconfig, as `pnpm start` does.
const TSCONFIG = fileURLToPath(
  new URL('../../../../apps/api/tsconfig.json', import.meta.url),
);

const dirs = useProject({
  version: 1,
  variables: { KEY: { type: 'string', secret: true, protected: true } },
  files: [{ path: '.env', policy: 'merge', mode: '600', variables: '*' }],
});

it('waits for a held write transaction, then records the fingerprint', async () => {
  const state = join(dirs.root, STATE);
  const release = await holdState(state);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: TSCONFIG,
  };
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
  setTimeout(release, 300);
  expect({ code: await code, err }).toEqual({ code: 0, err: '' });
  const recorded = await readState(state);
  expect(Object.keys(recorded.fingerprints['.env']!)).toEqual(['KEY']);
}, 15_000);
