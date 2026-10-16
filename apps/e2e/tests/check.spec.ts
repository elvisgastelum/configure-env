// Journey 7: fix the drift check reports, in place.

import { dotenvValue, expect, test } from '../src/fixtures.ts';
import { navigate } from '../src/portal.ts';

test('fix drift until every file matches the schema', async ({
  portal: page,
  served,
}) => {
  await navigate(page, 'Check');
  await page.getByRole('button', { name: 'Run check' }).click();
  await expect(page.getByText('3 files drift from the schema.')).toBeVisible();

  // A missing key: set its value where check lists it.
  await page
    .getByRole('button', { name: 'Set WEB_PORT in .env.example', exact: true })
    .click();
  await page
    .getByRole('textbox', {
      name: 'New value of WEB_PORT in .env.example',
      exact: true,
    })
    .fill('8080');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The fixed item leaves the report; its toast stays.
  await expect(page.getByText('Saved WEB_PORT in .env.example')).toBeVisible();
  await expect
    .poll(async () =>
      dotenvValue(await served.read('.env.example'), 'WEB_PORT'),
    )
    .toBe('8080');
  await expect(
    page.getByRole('region', { name: '.env.example', exact: true }),
  ).toContainText('Nothing to fix.');

  // An invalid value: replace it.
  await page
    .getByRole('button', {
      name: 'Set VITE_CONTACT_WHATSAPP in .env',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', {
      name: 'New value of VITE_CONTACT_WHATSAPP in .env',
      exact: true,
    })
    .fill('off');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () =>
      dotenvValue(await served.read('.env'), 'VITE_CONTACT_WHATSAPP'),
    )
    .toBe('off');
  await expect(
    page.getByRole('region', { name: '.env', exact: true }),
  ).toContainText('Nothing to fix.');

  // A file that does not exist: apply it alone.
  await page
    .getByRole('button', { name: 'Apply deploy/.env.production.example' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Apply' });
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await dialog.getByRole('button', { name: 'Apply…' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Write 1 file?');
  await dialog.getByRole('button', { name: 'Write', exact: true }).click();
  // No result step here: see the test below.
  await expect
    .poll(async () =>
      dotenvValue(
        await served.read('deploy/.env.production.example').catch(() => ''),
        'COMPOSE_PROJECT_NAME',
      ),
    )
    .toBe('elvisgastelum-com');

  await expect(
    page.getByText('Every env file matches the schema.'),
  ).toBeVisible();
});

test('applying one file from check keeps its result until Done', async ({
  portal: page,
}) => {
  // The file stops drifting once written and its "Apply <path>" button
  // leaves the report; the dialog it opened must stay until Done.
  await navigate(page, 'Check');
  await page
    .getByRole('button', { name: 'Apply deploy/.env.production.example' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Apply' });
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await dialog.getByRole('button', { name: 'Apply…' }).click();
  await dialog.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByText('1 file written.')).toBeVisible();
  // The report refreshes after the write; the result must survive it.
  await page.waitForTimeout(1_500);
  await expect(page.getByText('1 file written.')).toBeVisible({ timeout: 1 });
  await page.getByRole('button', { name: 'Done' }).click({ timeout: 2_000 });
});
