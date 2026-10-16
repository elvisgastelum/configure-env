// S5: full keyboard paths, visible focus rings and names on icon buttons.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../src/fixtures.ts';

/** Each page, and the primary action a keyboard user tabs to on it. */
const PAGES: {
  path: string;
  heading: RegExp | string;
  action: (page: Page) => Locator;
}[] = [
  {
    path: '/',
    heading: /configure-env-e2e-portfolio-/,
    action: (page) =>
      page
        .getByRole('region', { name: 'Check' })
        .getByRole('button', { name: 'Run check' }),
  },
  {
    path: '/variables',
    heading: 'Variables',
    action: (page) => page.getByRole('searchbox', { name: 'Search variables' }),
  },
  {
    path: '/files',
    heading: 'Files',
    action: (page) =>
      page
        .getByRole('main')
        .getByRole('button', { name: 'Apply', exact: true }),
  },
  {
    path: '/schema',
    heading: 'Schema',
    action: (page) => page.getByRole('button', { name: 'Add variable' }),
  },
  {
    path: '/check',
    heading: 'Check',
    action: (page) => page.getByRole('button', { name: 'Run check' }),
  },
  {
    path: '/validate',
    heading: 'Validate',
    action: (page) => page.getByRole('button', { name: 'Run validate' }),
  },
  {
    path: '/history',
    heading: 'History',
    action: (page) => page.getByRole('combobox', { name: 'File' }),
  },
];

/**
 * What the focused element shows: the FOCUS_RING recipe
 * (`focus-visible:ring-3`) draws a box-shadow; an outline counts too.
 */
function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const ring = style.boxShadow !== 'none' && style.boxShadow !== '';
    const outline =
      style.outlineStyle !== 'none' &&
      Number.parseFloat(style.outlineWidth) > 0;
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
    const label =
      element.getAttribute('aria-label') ??
      element.textContent?.trim().slice(0, 40) ??
      '';
    const name = `${role} "${label}"`;
    return { name, visible: ring || outline };
  });
}

for (const { path, heading, action } of PAGES) {
  test(`keyboard: skip link, navigation and the primary action of ${path}`, async ({
    portal: page,
    served,
  }) => {
    // PV-20 T3: on /schema the "Variables" tabpanel (role=tabpanel,
    // tabindex=0) is a tab stop that shows no focus ring.
    test.fail(path === '/schema', 'the schema tabpanel has no focus ring');
    await page.goto(served.origin + path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);

    // The first Tab lands on the skip link, which moves focus to the content.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    expect((await focusIndicator(page))?.visible).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    // From the top again: through the navigation to the primary action, and
    // every stop on the way shows where the focus is.
    await page.goto(served.origin + path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    const target = action(page);
    const nav = page.getByRole('navigation', { name: 'Portal' });
    let passedNav = false;
    const invisible: string[] = [];
    for (let stop = 0; stop < 60; stop++) {
      await page.keyboard.press('Tab');
      const indicator = await focusIndicator(page);
      if (indicator && !indicator.visible) invisible.push(indicator.name);
      if (await nav.evaluate((el) => el.contains(document.activeElement)))
        passedNav = true;
      if (await target.evaluate((el) => el === document.activeElement)) break;
    }
    expect(passedNav).toBe(true);
    await expect(target).toBeFocused();
    expect(invisible).toEqual([]);
  });
}

test('keyboard: a page link in the navigation opens with Enter', async ({
  portal: page,
}) => {
  const link = page
    .getByRole('navigation', { name: 'Portal' })
    .getByRole('link', { name: 'Schema', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schema');
  await expect(link).toHaveAttribute('aria-current', 'page');
});

test('every button without text has an accessible name', async ({
  portal: page,
  served,
}) => {
  const unnamed: string[] = [];
  for (const { path, heading } of PAGES) {
    await page.goto(served.origin + path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await page.waitForTimeout(300);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"]')]
        .filter((button) => !button.textContent?.trim())
        .filter((button) => {
          const label = button.getAttribute('aria-label')?.trim();
          const labelledBy = button
            .getAttribute('aria-labelledby')
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim())
            .join('');
          const title = button.getAttribute('title')?.trim();
          return !label && !labelledBy && !title;
        })
        .map((button) => button.outerHTML.slice(0, 120)),
    );
    unnamed.push(...found.map((html) => `${path}: ${html}`));
  }
  expect(unnamed).toEqual([]);
});
