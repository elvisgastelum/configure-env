import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const configDir = fileURLToPath(new URL('./.storybook', import.meta.url));

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
  // Pre-bundle every dependency the stories reach before the first test,
  // so Vite never re-optimizes and reloads the browser mid-run (a cold CI
  // cache would otherwise fail the first files).
  optimizeDeps: {
    entries: ['src/**/*.stories.tsx', '.storybook/preview.tsx'],
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
