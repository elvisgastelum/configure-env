// S5: zero axe violations on every page and open dialog, in both themes.

import type { Page } from '@playwright/test';
import { axeViolations } from '../src/axe.ts';
import { expect, test } from '../src/fixtures.ts';
import { openDrawer, rowOf, useTheme, variablesOf } from '../src/portal.ts';

const ROUTES = [
  '/',
  '/variables',
  '/groups',
  '/files',
  '/schema',
  '/check',
  '/history',
];

/** Waits for a page's data to settle, then scans it. */
async function scan(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // Let enter animations finish so colors are scanned at full opacity.
  await page.waitForTimeout(500);
  return axeViolations(page);
}

for (const theme of ['Light', 'Dark'] as const) {
  for (const route of ROUTES) {
    test(`axe: ${route} in the ${theme.toLowerCase()} theme`, async ({
      portal: page,
      served,
    }) => {
      await useTheme(page, theme);
      await page.goto(served.origin + route);
      expect(await scan(page)).toEqual([]);
    });
  }

  test.describe('a project without a schema', () => {
    test.use({ fixture: 'empty' });

    test(`axe: the init card in the ${theme.toLowerCase()} theme`, async ({
      portal: page,
    }) => {
      await useTheme(page, theme);
      await expect(
        page.getByRole('heading', { name: 'No schema yet' }),
      ).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });
  });

  test(`axe: open dialogs in the ${theme.toLowerCase()} theme`, async ({
    portal: page,
    served,
  }) => {
    await useTheme(page, theme);
    const found: string[] = [];
    const scanOpen = async (label: string) => {
      await page.waitForTimeout(500);
      for (const line of await axeViolations(page))
        found.push(`${label}: ${line}`);
    };

    await variablesOf(page, '.env');
    // A menu opened on the page portals into <main>, inside a landmark.
    await rowOf(page, 'CONTACT_API_TOKEN')
      .getByRole('button', { name: /^Copy CONTACT_API_TOKEN/ })
      .first()
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    await scanOpen('page copy menu');
    await page.keyboard.press('Escape');

    const drawer = await openDrawer(page, 'CONTACT_API_TOKEN');
    await drawer
      .getByRole('button', {
        name: 'Reveal CONTACT_API_TOKEN in .env',
        exact: true,
      })
      .click();
    await scanOpen('variable drawer');
    await drawer
      .getByRole('button', {
        name: 'Copy CONTACT_API_TOKEN in .env',
        exact: true,
      })
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    await scanOpen('copy menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(`${served.origin}/schema`);
    await page.getByRole('button', { name: 'Add variable' }).click();
    await scanOpen('add variable form');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Edit WEB_HOST', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('APP_HOST');
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Rename WEB_HOST to APP_HOST' }),
    ).toBeVisible();
    await scanOpen('review dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(`${served.origin}/check`);
    await page.getByRole('button', { name: 'Apply every file' }).click();
    const apply = page.getByRole('dialog', { name: 'Apply' });
    await apply.getByRole('button', { name: 'Preview' }).click();
    await expect(apply.getByText('2 files change')).toBeVisible();
    await scanOpen('apply plan');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Search/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'Command palette' }),
    ).toBeVisible();
    await scanOpen('command palette');

    expect(found).toEqual([]);
  });
}
