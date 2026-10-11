import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const configDir = fileURLToPath(new URL('./.storybook', import.meta.url));
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Every bare package import in `src`, so Vite pre-bundles them all before
 * the first story runs. A dependency it found mid-run would make it
 * re-optimize and reload the browser, failing the files in flight; with a
 * warm cache Vite skips its own scan, so the list is built here.
 */
function storyDependencies(): string[] {
  const specifiers = new Set<string>();
  const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' });
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const [, specifier] of text.matchAll(/from '([^'.][^']*)'/g)) {
      if (specifier && !specifier.startsWith('@storybook/')) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers].sort();
}

/*
 * Every story runs in headless Chromium once per theme. The Storybook
 * preview reads the theme from `STORYBOOK_THEME` and fails a story on any
 * axe violation (`parameters.a11y.test: 'error'`), color contrast included.
 */
const storybookProject = (theme: 'light' | 'dark') => ({
  extends: true,
  plugins: [storybookTest({ configDir, tags: { exclude: ['skip-test'] } })],
  define: {
    'import.meta.env.STORYBOOK_THEME': JSON.stringify(theme),
  },
  optimizeDeps: {
    entries: ['src/**/*.stories.tsx', '.storybook/preview.tsx'],
    include: storyDependencies(),
  },
  test: {
    name: `storybook-${theme}`,
    setupFiles: ['.storybook/vitest.setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' as const }],
    },
  },
});

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      storybookProject('light'),
      storybookProject('dark'),
    ],
  },
});
