// Journeys 4 and 5: add a variable of each type family; rename a variable
// and check that every reference follows it.

import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures.ts';
import { navigate, toast } from '../src/portal.ts';

/**
 * One type of each family the schema editor offers (core's VARIABLE_TYPES):
 * text, number, boolean, enum and network. `fill` sets what the type needs
 * beyond a name; `expected` is what env.schema.json must then hold.
 */
const FAMILIES: {
  family: string;
  type: string;
  name: string;
  fill?: (page: Page) => Promise<void>;
  expected: Record<string, unknown>;
}[] = [
  {
    family: 'text',
    type: 'email',
    name: 'SUPPORT_EMAIL',
    expected: { type: 'email' },
  },
  {
    family: 'number',
    type: 'integer',
    name: 'WORKER_COUNT',
    fill: async (page) => {
      await page
        .getByRole('textbox', { name: 'Minimum', exact: true })
        .fill('1');
      await page
        .getByRole('textbox', { name: 'Maximum', exact: true })
        .fill('16');
    },
    expected: { type: 'integer', min: 1, max: 16 },
  },
  {
    family: 'boolean',
    type: 'boolean',
    name: 'FEATURE_BETA',
    expected: { type: 'boolean' },
  },
  {
    family: 'enum',
    type: 'enum',
    name: 'LOG_LEVEL',
    fill: async (page) => {
      for (const [index, value] of ['debug', 'info', 'warn'].entries()) {
        await page.getByRole('button', { name: 'Add a value' }).click();
        await page
          .getByRole('textbox', { name: `Value ${index + 1}`, exact: true })
          .fill(value);
      }
    },
    expected: { type: 'enum', values: ['debug', 'info', 'warn'] },
  },
  {
    family: 'network',
    type: 'cidr',
    name: 'ALLOWED_NETWORK',
    expected: { type: 'cidr' },
  },
];

/** Picks an option of a select the form labels `label`. */
async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Saves the open form through its review dialog. */
async function reviewAndSave(page: Page, title: string) {
  await page.getByRole('button', { name: 'Review changes' }).click();
  const review = page.getByRole('dialog', { name: title });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Saved env.schema.json')).toBeVisible();
  await expect(review).toBeHidden();
}

for (const { family, type, name, fill, expected } of FAMILIES) {
  test(`add a variable of the ${family} family (${type})`, async ({
    portal: page,
    served,
  }) => {
    await navigate(page, 'Schema');
    await page.getByRole('button', { name: 'Add variable' }).click();
    const form = page.getByRole('dialog', { name: 'Add a variable' });
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await pick(page, 'Type', type);
    await form
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill(`A ${family} variable the e2e suite adds.`);
    await fill?.(page);
    await form.getByRole('checkbox', { name: '.env', exact: true }).check();
    await reviewAndSave(page, `Add ${name}`);

    const schema = await served.schema();
    expect(schema.variables[name]).toMatchObject({
      ...expected,
      description: `A ${family} variable the e2e suite adds.`,
    });
    expect(
      schema.files.find((file) => file.path === '.env')?.variables,
    ).toContain(name);
    await expect(
      page
        .getByRole('list', { name: 'Variables in schema order' })
        .getByRole('button', { name: `Edit ${name}`, exact: true }),
    ).toBeVisible();
  });
}

test('rename a variable and its references follow @smoke', async ({
  portal: page,
  served,
}) => {
  await navigate(page, 'Schema');
  await page
    .getByRole('button', { name: 'Edit WEB_HOST', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Edit WEB_HOST' });
  await form
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('APP_HOST');
  // The form lists what the rename rewrites before anything is saved.
  const references = form.getByRole('list', {
    name: 'References a rename rewrites',
  });
  await expect(references).toBeVisible();
  await expect(references.getByRole('listitem')).not.toHaveCount(0);
  await reviewAndSave(page, 'Rename WEB_HOST to APP_HOST');

  const schema = await served.schema();
  expect(schema.variables).toHaveProperty('APP_HOST');
  expect(schema.variables).not.toHaveProperty('WEB_HOST');
  const text = JSON.stringify(schema.files);
  expect(text).not.toContain('WEB_HOST');
  for (const path of [
    'deploy/.env.production.example',
    '.env.example',
    '.env',
  ]) {
    const file = schema.files.find((entry) => entry.path === path)!;
    expect(file.variables).toContain('APP_HOST');
  }
  const production = schema.files.find(
    (entry) => entry.path === 'deploy/.env.production.example',
  )!;
  expect(production.values).toEqual({ APP_HOST: '192.168.1.<CT ID>' });

  const list = page.getByRole('list', { name: 'Variables in schema order' });
  await expect(
    list.getByRole('button', { name: 'Edit APP_HOST', exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole('button', { name: 'Edit WEB_HOST', exact: true }),
  ).toHaveCount(0);
  // The variables page shows the new name too.
  await navigate(page, 'Variables');
  await expect(
    page.getByRole('button', { name: 'APP_HOST', exact: true }),
  ).toBeVisible();
});
