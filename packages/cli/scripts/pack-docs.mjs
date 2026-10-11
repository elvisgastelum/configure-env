// README.md and LICENSE live at the repo root, where GitHub shows them; the
// published package still ships them. `prepack` copies them next to this
// package.json and `postpack` removes the copies (both are gitignored).
//
//   node scripts/pack-docs.mjs copy|remove

import { copyFileSync, rmSync } from 'node:fs';

const DOCS = ['README.md', 'LICENSE'];
const pkg = new URL('../', import.meta.url);
const root = new URL('../../../', import.meta.url);

const mode = process.argv[2];
for (const name of DOCS) {
  if (mode === 'copy') copyFileSync(new URL(name, root), new URL(name, pkg));
  else if (mode === 'remove') rmSync(new URL(name, pkg), { force: true });
  else {
    console.error('usage: node scripts/pack-docs.mjs copy|remove');
    process.exit(2);
  }
}
