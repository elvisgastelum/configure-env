// Journey 1: open the portal through the launch URL serve prints.

import { expect, test } from '../src/fixtures.ts';

test('the launch URL signs the tab in and lands on the overview @smoke', async ({
  page,
  served,
}) => {
  await page.goto(served.launchUrl);
  // The token is traded for an HttpOnly cookie and dropped from the URL.
  await expect(page).toHaveURL(`${served.origin}/`);
  await expect(page.getByRole('navigation', { name: 'Portal' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /configure-env-e2e-portfolio-/,
  );
  await expect(page.getByRole('link', { name: 'Schema valid' })).toBeVisible();
  const cookies = await page.context().cookies(served.origin);
  expect(cookies.some((cookie) => cookie.httpOnly)).toBe(true);
  // The reduced-motion project really asks for reduced motion.
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(test.info().project.name === 'reduced-motion');
});

test('a tab that loses its session asks for the launch link @smoke', async ({
  portal,
  served,
}) => {
  await portal.context().clearCookies();
  // A schema change outside the portal makes it read the project again (the
  // event stream it opened earlier stays up), and that read is refused.
  await served.write(
    'env.schema.json',
    `${await served.read('env.schema.json')}\n`,
  );
  await expect(
    portal.getByRole('heading', { name: 'Open the launch link again' }),
  ).toBeVisible();
  await expect(
    portal.getByText('This tab has no session with the configure-env server.', {
      exact: false,
    }),
  ).toBeVisible();
  // A wrong token opens no session either.
  await portal.goto(`${served.origin}/launch?token=not-the-token`);
  await expect(portal.getByRole('navigation', { name: 'Portal' })).toHaveCount(
    0,
  );
});

test('a fresh tab without the session cookie asks for the launch link', async ({
  browser,
  served,
}) => {
  // The server answers a page request without the session with a 401 page
  // of its own, never the portal or the JSON error.
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(served.origin);
    await expect(
      page.getByRole('heading', { name: 'Open the launch link again' }),
    ).toBeVisible({ timeout: 3_000 });
  } finally {
    await context.close();
  }
});
