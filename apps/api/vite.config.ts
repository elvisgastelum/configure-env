// `vp pack` bundles the server into dist/ (dist/main.js runs it standalone).
// The CLI bundles src/index.ts itself; this build also measures what that
// adds.

import { defineConfig } from 'vite-plus';

export default defineConfig({
  // Nest's decorators are TypeScript's legacy (experimental) ones.
  oxc: { decorator: { legacy: true } },
  test: { include: ['src/**/*.test.ts'] },
  run: { tasks: { build: 'vp pack', test: 'vp test run' } },
  pack: {
    entry: { index: 'src/index.ts', main: 'src/main.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    sourcemap: true,
    tsconfig: 'tsconfig.build.json',
  },
});
