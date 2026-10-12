// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '.atl/',
    '**/dist/',
    '**/coverage/',
    '**/storybook-static/',
    // Generated: TanStack Router's route tree and msw's service worker.
    'apps/web/src/routeTree.gen.ts',
    'apps/web/.storybook/public/mockServiceWorker.js',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Everything in the workspace runs under Node by default; the browser
    // packages below add browser globals.
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/design-system/**', 'apps/web/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/design-system/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
  },
  {
    // TanStack Router's file routes export their `Route` beside their
    // components; its code splitting moves the components out, so they
    // still hot-reload.
    files: ['apps/web/src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // The build config and the Node test that serves the built portal.
    files: ['apps/web/vite.config.ts', 'apps/web/test/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // shadcn atoms export cva `*Variants` beside components, and Storybook
    // config and stories export decorators, parameters and story objects;
    // fast refresh does not apply to them.
    files: [
      'packages/design-system/src/components/atoms/**/*.tsx',
      'packages/design-system/.storybook/**/*.{ts,tsx}',
      'packages/design-system/**/*.stories.tsx',
      'apps/web/.storybook/**/*.{ts,tsx}',
      'apps/web/**/*.stories.tsx',
      'apps/web/src/test/**/*.{ts,tsx}',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // Last, so formatting is Prettier's job alone.
  prettier,
);
