// Journey: the environment picker. A second serve stands in for a dev
// server; the local serve lists it and forwards the portal's requests to it
// through /env/dev/api/, so the page stays on the local origin and never
// holds the other server's token.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { axeViolations } from '../src/axe.ts';
import { expect, test } from '../src/fixtures.ts';
import { rowOf, toast, useTheme, variablesOf } from '../src/portal.ts';
import {
  type Served,
  addEnvironment,
  copyFixture,
  removeFixture,
  startServe,
} from '../src/serve.ts';

test('switches between the local project and another environment @smoke', async ({
  portal: page,
  served,
}) => {
  const devDir = await copyFixture('portfolio');
  let dev: Served | undefined;
  try {
    const text = await served.read('.env');
    await writeFile(
      join(devDir, '.env'),
      text.replace('WEB_PORT=8080', 'WEB_PORT=7070'),
    );
    dev = await startServe(devDir);
    await addEnvironment(served.dir, 'dev', dev);

    // Every request the page makes, to check none leaves the local origin.
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.reload();

    const header = page.getByTestId('app-header');
    const picker = header.getByRole('combobox', { name: 'Environment' });
    await expect(picker).toHaveText(/local/);
    await expect(header.getByText(served.dir)).toBeVisible();
    await variablesOf(page, '.env');
    const value = rowOf(page, 'WEB_PORT').getByRole('gridcell').nth(1);
    await expect(value).toHaveText('8080');

    await picker.click();
    await page.getByRole('option', { name: /dev/ }).click();

    await expect(picker).toHaveText(/dev/);
    await expect(header.getByText(devDir)).toBeVisible();
    // Another project: the views start over, from its own files.
    await variablesOf(page, '.env');
    await expect(value).toHaveText('7070');
    // Its files are on another machine: no Open in editor.
    await expect(page.getByRole('button', { name: /in editor$/ })).toHaveCount(
      0,
    );

    // Its events stream through the gateway too.
    const devText = await readFile(join(devDir, '.env'), 'utf8');
    await writeFile(
      join(devDir, '.env'),
      devText.replace('WEB_PORT=7070', 'WEB_PORT=7171'),
    );
    await expect(
      toast(page, '.env changed outside the portal; the views show it now.'),
    ).toBeVisible();
    await expect(value).toHaveText('7171');

    await picker.click();
    await page.getByRole('option', { name: /local/ }).click();
    await expect(picker).toHaveText(/local/);
    await expect(header.getByText(served.dir)).toBeVisible();
    await variablesOf(page, '.env');
    await expect(value).toHaveText('8080');

    const origins = new Set(requested.map((url) => new URL(url).origin));
    expect([...origins]).toEqual([served.origin]);
    expect(
      requested.some((url) =>
        new URL(url).pathname.startsWith('/env/dev/api/'),
      ),
    ).toBe(true);
  } finally {
    await dev?.stop();
    await removeFixture(devDir);
  }
});

test('sets prod apart in the header, accessibly in both themes', async ({
  portal: page,
  served,
}) => {
  const prodDir = await copyFixture('portfolio');
  let prod: Served | undefined;
  try {
    prod = await startServe(prodDir);
    await addEnvironment(served.dir, 'prod', prod);
    await page.reload();

    const picker = page
      .getByTestId('app-header')
      .getByRole('combobox', { name: 'Environment' });
    await picker.click();
    await page.getByRole('option', { name: /prod/ }).click();
    await expect(picker).toHaveText(/prod/);
    await expect(picker).toHaveAttribute('data-production', 'true');
    await expect(picker).toContainText('Production');

    for (const theme of ['Light', 'Dark'] as const) {
      await useTheme(page, theme);
      // Let the theme's color transition finish before the colors are read.
      await page.waitForTimeout(500);
      expect(await axeViolations(page, '[data-testid="app-header"]')).toEqual(
        [],
      );
    }
  } finally {
    await prod?.stop();
    await removeFixture(prodDir);
  }
});
