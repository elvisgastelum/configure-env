// @ts-check
// Bundles the server into dist/ (dist/main.js runs it standalone). The CLI
// will bundle src/index.ts itself; this build also measures what that adds.

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  sourcemap: true,
  tsconfig: 'tsconfig.build.json',
});
