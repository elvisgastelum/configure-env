// Journeys 2 and 3: browse, search, reveal and copy a secret; edit a value.

import { dotenvValue, expect, test } from '../src/fixtures.ts';
import {
  navigate,
  openDrawer,
  rowOf,
  toast,
  variablesOf,
} from '../src/portal.ts';

test('browse, search, reveal and copy a secret @smoke', async ({
  portal: page,
  served,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: served.origin,
  });
  const secret = dotenvValue(await served.read('.env'), 'CONTACT_API_TOKEN')!;

  await navigate(page, 'Variables');
  await expect(page.getByText('9 variables', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search variables' }).fill('token');
  await expect(page.getByText('1 of 9 variables')).toBeVisible();
  await expect(rowOf(page, 'CONTACT_API_TOKEN')).toBeVisible();
  await expect(rowOf(page, 'WEB_PORT')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'File' }).click();
  await page.getByRole('option', { name: '.env', exact: true }).click();
  // Masked until revealed: the grid shows only the last characters.
  const row = rowOf(page, 'CONTACT_API_TOKEN');
  await expect(row).not.toContainText(secret);

  const drawer = await openDrawer(page, 'CONTACT_API_TOKEN');
  await expect(drawer).not.toContainText(secret);
  await drawer
    .getByRole('button', {
      name: 'Reveal CONTACT_API_TOKEN in .env',
      exact: true,
    })
    .click();
  await expect(drawer.getByText(secret)).toBeVisible();
  await expect(
    drawer.getByRole('button', {
      name: 'Hide CONTACT_API_TOKEN in .env',
      exact: true,
    }),
  ).toBeVisible();

  await drawer
    .getByRole('button', {
      name: 'Copy CONTACT_API_TOKEN in .env',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Value', exact: true }).click();
  await expect(
    toast(page, 'Copied the value of CONTACT_API_TOKEN'),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    secret,
  );
});

test('edit a value and the file on disk changes @smoke', async ({
  portal: page,
  served,
}) => {
  await variablesOf(page, '.env');
  const drawer = await openDrawer(page, 'WEB_PORT');
  await drawer
    .getByRole('button', { name: 'Edit WEB_PORT in .env', exact: true })
    .click();
  const input = drawer.getByRole('textbox', {
    name: 'New value of WEB_PORT in .env',
    exact: true,
  });
  await input.fill('9090');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Saved WEB_PORT in .env')).toBeVisible();

  await expect
    .poll(async () => dotenvValue(await served.read('.env'), 'WEB_PORT'))
    .toBe('9090');
  // Other lines stay as they were.
  expect(dotenvValue(await served.read('.env'), 'WEB_HOST')).toBe('127.0.0.1');
  await page.keyboard.press('Escape');
  await expect(rowOf(page, 'WEB_PORT').getByRole('gridcell').nth(1)).toHaveText(
    '9090',
  );
});
