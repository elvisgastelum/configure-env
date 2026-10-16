// serve, run from source, hands out apps/web/dist; without it, it serves the
// API alone and every page test would fail on a 404, and a stale one would
// test yesterday's portal. Build it before every run (Vite takes seconds).

import { execFileSync } from 'node:child_process';
import { REPO } from './serve.ts';

export default function globalSetup() {
  execFileSync('pnpm', ['--filter', '@configure-env/web', 'build'], {
    cwd: REPO,
    stdio: 'inherit',
  });
}
