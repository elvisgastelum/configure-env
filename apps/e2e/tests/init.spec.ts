// Journey 10: a project with only a .env.example gets its schema from the
// portal: serve starts without one, and the overview's "No schema yet" card
// inits it the way `configure-env init` would.

import { expect, test } from '../src/fixtures.ts';
import { navigate, toast } from '../src/portal.ts';

test.use({ fixture: 'empty' });

/** The keys a dotenv text sets, in order. */
function keysOf(text: string): string[] {
  return [
    ...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm),
  ].map((match) => match[1]!);
}

test('init from .env.example writes the schema and the portal shows it @smoke', async ({
  portal: page,
  served,
}) => {
  const keys = keysOf(await served.read('.env.example'));
  expect(keys.length).toBeGreaterThan(0);
  await expect(served.read('env.schema.json')).rejects.toThrow(/ENOENT/);

  await expect(
    page.getByRole('heading', { name: 'No schema yet' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Init from .env.example', exact: true })
    .click();

  const noun = keys.length === 1 ? 'variable' : 'variables';
  await expect(
    toast(page, `Wrote env.schema.json: ${keys.length} ${noun}`),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No schema yet' }),
  ).toHaveCount(0);

  // On disk: every key of the example, and the state kept out of git.
  const schema = await served.schema();
  expect(Object.keys(schema.variables)).toEqual(keys);
  expect(await served.read('.gitignore')).toContain('.configure-env/');

  // The portal lists them without a reload.
  await navigate(page, 'Variables');
  for (const key of keys)
    await expect(page.getByRole('rowheader', { name: key })).toBeVisible();
});
