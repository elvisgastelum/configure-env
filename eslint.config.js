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
    // Everything in the workspace runs under Node today. A browser app adds
    // its own block with browser globals when it lands.
    languageOptions: { globals: globals.node },
  },
  // Last, so formatting is Prettier's job alone.
  prettier,
);
