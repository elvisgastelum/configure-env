// Steps the journeys share, through roles and accessible names only.

import { expect, type Locator, type Page } from '@playwright/test';

/** Moves to a page through the "Portal" navigation, as a person would. */
export async function navigate(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Portal' })
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** The variables page, showing the values of `file`. */
export async function variablesOf(page: Page, file: string) {
  await navigate(page, 'Variables');
  await page.getByRole('combobox', { name: 'File' }).click();
  await page.getByRole('option', { name: file, exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: `Value in ${file}` }),
  ).toBeVisible();
}

/** The grid row of a variable. */
export const rowOf = (page: Page, name: string) =>
  page
    .getByRole('grid', { name: 'Variables' })
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

/** Opens a variable's drawer from the grid and returns it. */
export async function openDrawer(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name, exact: true }).click();
  const drawer = page.getByRole('dialog', { name });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** A toast with this text. */
export const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('region', { name: /Notifications/ }).getByText(text);

/** Picks a theme in the header, as a person would. */
export async function useTheme(page: Page, theme: 'Light' | 'Dark') {
  await page
    .getByRole('group', { name: 'Theme' })
    .getByRole('button', { name: theme, exact: true })
    .click();
  await expect(page.locator('html')).toHaveClass(
    theme === 'Dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
}
