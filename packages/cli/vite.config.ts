// `vp pack` builds dist/ for npm: the bin (dist/cli.js) and the programmatic
// API (dist/index.js with its bundled declarations), with source maps.
// The private workspace packages are inlined: @configure-env/core, and
// @configure-env/api, which `serve` imports dynamically, so it lands in its
// own chunk that no other command loads. The published dependencies (zod,
// @clack/prompts, better-sqlite3 with its native binding, drizzle-orm, the
// API's NestJS runtime and launch-editor) stay imports. The core's migrations
// are copied to dist/migrations by scripts/copy-migrations.mjs, the portal to
// dist/web by scripts/copy-web.mjs.
//
// The API's Nest decorators are TypeScript's legacy ones:
// tsconfig.build.json's experimentalDecorators turns them on for the bundle.

import { defineConfig } from 'vite-plus';

const pnpmRunState = {
  pattern: '!node_modules/.pnpm-task-run-state-v1/**',
  base: 'workspace',
} as const;

export default defineConfig({
  // `serve` runs @configure-env/api from its sources in the tests, and Nest's
  // decorators are TypeScript's legacy (experimental) ones.
  oxc: { decorator: { legacy: true } },
  run: {
    tasks: {
      // dist/ is the output only: the copy steps write into it, so it never
      // counts as an input.
      build: {
        command:
          'node scripts/pack-docs.mjs remove && vp pack && node scripts/copy-migrations.mjs && node scripts/copy-web.mjs',
        cache: { input: [{ auto: true }, '!dist/**'], output: ['dist/**'] },
      },
      test: {
        command: 'vp test run',
        // The tests start pnpm, which keeps its own run state there.
        cache: {
          input: [{ auto: true }, pnpmRunState],
          output: [{ auto: true }, pnpmRunState],
        },
      },
      'schema:check': 'tsx scripts/generate-json-schema.ts --check',
    },
  },
  pack: {
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
        'launch-editor',
      ],
    },
  },
});
