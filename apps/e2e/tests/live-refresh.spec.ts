// Journey 9: a file edited outside the portal shows up without a reload.

import { expect, test } from '../src/fixtures.ts';
import { rowOf, toast, variablesOf } from '../src/portal.ts';

test('an external edit refreshes the views @smoke', async ({
  portal: page,
  served,
}) => {
  await variablesOf(page, '.env');
  const value = rowOf(page, 'WEB_PORT').getByRole('gridcell').nth(1);
  await expect(value).toHaveText('8080');

  const text = await served.read('.env');
  await served.write('.env', text.replace('WEB_PORT=8080', 'WEB_PORT=9191'));

  await expect(
    toast(page, '.env changed outside the portal; the views show it now.'),
  ).toBeVisible();
  await expect(value).toHaveText('9191');
});
