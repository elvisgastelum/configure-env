// @ts-check
// Builds dist/ for npm: the bin (dist/cli.js) and the programmatic API
// (dist/index.js with its bundled declarations), with source maps.
// @configure-env/core is a private workspace package, so it is inlined; the
// published dependencies (zod, @clack/prompts) stay imports.

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // The package is `"type": "module"`: plain .js and .d.ts.
  fixedExtension: false,
  sourcemap: true,
  dts: { eager: true },
  tsconfig: 'tsconfig.build.json',
  // The output may import only the published dependencies and Node's
  // built-ins; anything else fails the build.
  deps: { onlyImport: ['zod', '@clack/prompts'] },
});
