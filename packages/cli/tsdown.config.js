// @ts-check
// Builds dist/ for npm: the bin (dist/cli.js) and the programmatic API
// (dist/index.js with its bundled declarations), with source maps.
// The private workspace packages are inlined: @configure-env/core, and
// @configure-env/api, which `serve` imports dynamically, so it lands in its
// own chunk that no other command loads. The published dependencies (zod,
// @clack/prompts, better-sqlite3 with its native binding, drizzle-orm, and
// the API's NestJS runtime) stay imports. The core's migrations are copied
// to dist/migrations by scripts/copy-migrations.mjs, the portal to dist/web
// by scripts/copy-web.mjs.
//
// The API's Nest decorators are TypeScript's legacy ones:
// tsconfig.json's experimentalDecorators turns them on for the bundle.

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
  deps: {
    onlyImport: [
      'zod',
      '@clack/prompts',
      'better-sqlite3',
      'drizzle-orm',
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express',
      '@nestjs/swagger',
      'reflect-metadata',
      'rxjs',
    ],
  },
});
