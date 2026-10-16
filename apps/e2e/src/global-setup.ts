// serve hands out apps/web/dist; without it, it serves the API alone and
// every page test would fail on a 404. Build it once when it is missing.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORTAL_DIST, REPO } from './serve.ts';

export default function globalSetup() {
  if (existsSync(join(PORTAL_DIST, 'index.html'))) return;
  console.log('apps/web/dist is missing: building the portal first');
  execFileSync('pnpm', ['--filter', '@configure-env/web', 'build'], {
    cwd: REPO,
    stdio: 'inherit',
  });
}
