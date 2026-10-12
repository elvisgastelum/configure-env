// The portal (apps/web, built by Vite into apps/web/dist) ships in
// dist/web, which `configure-env serve` passes to the API as its static
// files. `build` runs this after tsdown; the workspace builds apps/web
// first, since this package lists @configure-env/web as a dev dependency.
//
//   node scripts/copy-web.mjs

import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = new URL('../../../apps/web/dist/', import.meta.url);
const to = new URL('../dist/web/', import.meta.url);

if (!existsSync(new URL('index.html', from))) {
  console.error(
    `copy-web: no portal build at ${fileURLToPath(from)}; run pnpm build at the repository root`,
  );
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
