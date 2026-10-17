// The portal's end-to-end suite: every test starts its own
// `configure-env serve` on a free port over a temporary copy of a fixture
// project (src/fixtures.ts), so workers run side by side safely.

import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  // Each test compiles and starts a server first (a few seconds under tsx).
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Each worker runs a browser plus a serve child; CI runners have 2-4 cores.
  workers: CI ? 2 : '50%',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // The smoke journeys again, with the OS asking for reduced motion: the
      // portal's MotionConfig reducedMotion="user" must still work end to end.
      name: 'reduced-motion',
      grep: /@smoke/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      },
    },
  ],
});
