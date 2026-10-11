// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['.atl/', '**/dist/', '**/coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The CLI, the server-side packages and this config run under Node.
    files: ['eslint.config.js', 'packages/**', 'apps/api/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**'],
    languageOptions: { globals: globals.browser },
  },
  // Last, so formatting is Prettier's job alone.
  prettier,
);
