// Journey 6: plan and apply, as configure-env apply does.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dotenvValue, expect, test } from '../src/fixtures.ts';
import { navigate } from '../src/portal.ts';

test('plan and apply writes the files the plan shows @smoke', async ({
  portal: page,
  served,
}) => {
  const envBefore = await served.read('.env');
  await navigate(page, 'Check');
  await page.getByRole('button', { name: 'Apply every file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply' });
  await dialog.getByRole('button', { name: 'Preview' }).click();
  // The plan: the production template is created, .env.example gains the
  // key it misses, and .env (create-only, already there) is left alone.
  await expect(dialog.getByText('2 files change')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply…' }).click();
  // The confirmation is an alert inside the dialog, not a second dialog.
  await expect(dialog.getByRole('alert')).toContainText('Write 2 files?');
  await expect(dialog.getByRole('alert')).toContainText(
    'deploy/.env.production.example, .env.example',
  );
  await dialog.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByText('2 files written.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const production = await served.read('deploy/.env.production.example');
  expect(dotenvValue(production, 'WEB_HOST')).toBe('192.168.1.<CT ID>');
  expect(dotenvValue(production, 'COMPOSE_PROJECT_NAME')).toBe(
    'elvisgastelum-com',
  );
  expect(dotenvValue(await served.read('.env.example'), 'WEB_PORT')).toBe(
    '8080',
  );
  expect(await served.read('.env')).toBe(envBefore);
  expect(existsSync(join(served.dir, 'deploy'))).toBe(true);
  // Check no longer reports the files apply wrote.
  await expect(
    page.getByRole('region', { name: 'deploy/.env.production.example' }),
  ).toContainText('Current');
});
