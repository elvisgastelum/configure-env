// The README's portal screenshots, taken from the fixture projects. Skipped
// unless SCREENSHOTS=1: `pnpm e2e:screenshots` regenerates docs/portal/*.png.

import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures.ts';
import { REPO } from '../src/serve.ts';
import { navigate, useTheme, variablesOf } from '../src/portal.ts';

const OUT = join(REPO, 'docs/portal');

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate them');
test.use({ viewport: { width: 1280, height: 800 } });

/**
 * Waits for the data and the enter animations, then saves the page. The
 * project lives in a random temporary folder; the header shows it as
 * ~/projects/<fixture> instead, so no machine path reaches the README.
 */
async function shoot(page: Page, dir: string, name: string) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  const fixture = basename(dir).replace(/^configure-env-e2e-(\w+)-.*$/, '$1');
  await page.evaluate(
    ([path, folder, shown]) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        node.nodeValue = node
          .nodeValue!.replaceAll(path, `~/projects/${shown}`)
          .replaceAll(folder, shown);
    },
    [dir, basename(dir), fixture] as const,
  );
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test('portal pages', async ({ portal: page, served }) => {
  await useTheme(page, 'Light');
  await shoot(page, served.dir, 'overview');
  await variablesOf(page, '.env');
  await shoot(page, served.dir, 'variables');
  await navigate(page, 'Schema');
  await shoot(page, served.dir, 'schema');
  await navigate(page, 'Check');
  await page.getByRole('button', { name: 'Run check' }).click();
  await shoot(page, served.dir, 'check');
  await useTheme(page, 'Dark');
  await page.goto(`${served.origin}/variables`);
  await shoot(page, served.dir, 'variables-dark');
});

test.describe('a project without a schema', () => {
  test.use({ fixture: 'empty' });

  test('the init card', async ({ portal: page, served }) => {
    await useTheme(page, 'Light');
    await expect(
      page.getByRole('heading', { name: 'No schema yet' }),
    ).toBeVisible();
    await shoot(page, served.dir, 'init');
  });
});
