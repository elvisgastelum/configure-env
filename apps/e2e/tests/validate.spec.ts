// Journey 8: validate, and fix a value from its report.

import { dotenvValue, expect, test } from '../src/fixtures.ts';
import { navigate } from '../src/portal.ts';

test('validate reports the broken value and fixing it clears it @smoke', async ({
  portal: page,
  served,
}) => {
  await navigate(page, 'Validate');
  await page.getByRole('button', { name: 'Run validate' }).click();
  await expect(page.getByText('3 errors in 3 files.')).toBeVisible();
  const env = page.getByRole('region', { name: '.env', exact: true });
  await expect(
    env.getByRole('region', { name: 'VITE_CONTACT_WHATSAPP' }),
  ).toContainText('must be digits (country code first)');

  await env
    .getByRole('button', {
      name: 'Fix VITE_CONTACT_WHATSAPP in .env',
      exact: true,
    })
    .click();
  await env
    .getByRole('textbox', {
      name: 'New value of VITE_CONTACT_WHATSAPP in .env',
      exact: true,
    })
    .fill('526381177267');
  await env.getByRole('button', { name: 'Save', exact: true }).click();
  // No toast assertion: the fixed entry leaves the report, and the "Saved"
  // toast can be lost with it (reported for PV-20 T3; see the README).

  // The report runs again: .env has no error left.
  await expect(page.getByText('2 errors in 2 files.')).toBeVisible();
  await expect(env).toContainText('No errors.');
  await expect(
    env.getByRole('region', { name: 'VITE_CONTACT_WHATSAPP' }),
  ).toHaveCount(0);
  expect(dotenvValue(await served.read('.env'), 'VITE_CONTACT_WHATSAPP')).toBe(
    '526381177267',
  );
});
