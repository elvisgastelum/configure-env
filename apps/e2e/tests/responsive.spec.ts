// S6: layouts from 360px to wide desktop, and smooth scrolling.

import type { Page } from '@playwright/test';
import { expect, test } from '../src/fixtures.ts';

const WIDTHS = [360, 768, 1280, 1920];
const ROUTES = [
  '/',
  '/variables',
  '/files',
  '/schema',
  '/check',
  '/validate',
  '/history',
];

/** Whether the page scrolls sideways: it never should. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });

for (const width of WIDTHS) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`no page scrolls sideways at ${width}px`, async ({
      portal: page,
      served,
    }) => {
      const wide: string[] = [];
      for (const route of ROUTES) {
        await page.goto(served.origin + route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(300);
        const { scrollWidth, clientWidth } = await overflow(page);
        if (scrollWidth > clientWidth)
          wide.push(`${route}: ${scrollWidth}px > ${clientWidth}px`);
      }
      expect(wide).toEqual([]);
    });

    test(`the navigation is reachable at ${width}px @smoke`, async ({
      portal: page,
    }) => {
      const nav = page.getByRole('navigation', { name: 'Portal' });
      if (width < 768) {
        // Narrow screens keep the navigation behind a menu button.
        await expect(nav).toBeHidden();
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }
      await expect(nav).toBeVisible();
      await nav.getByRole('link', { name: 'Check', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check');
      await expect(nav).toBeVisible({ visible: width >= 768 });
    });

    test(`the apply plan fits the screen at ${width}px`, async ({
      portal: page,
      served,
    }) => {
      await page.goto(`${served.origin}/check`);
      await page.getByRole('button', { name: 'Apply every file' }).click();
      const dialog = page.getByRole('dialog', { name: 'Apply' });
      await dialog.getByRole('button', { name: 'Preview' }).click();
      await expect(dialog.getByText('2 files change')).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      // Long diff lines scroll inside their own box, not the whole dialog.
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    });
  });
}

test('scrolling a long variables page drops few frames', async ({
  portal: page,
  served,
}) => {
  // 300 more variables make the page long enough to scroll for a while.
  const schema = JSON.parse(await served.read('env.schema.json')) as {
    variables: Record<string, unknown>;
  };
  for (let index = 0; index < 300; index++)
    schema.variables[`EXTRA_${String(index).padStart(3, '0')}`] = {
      type: 'string',
      group: `Group ${index % 12}`,
      description: `Extra variable ${index}, so the list scrolls.`,
    };
  await served.write('env.schema.json', JSON.stringify(schema, null, 2));
  await page.goto(`${served.origin}/variables`);
  await expect(page.getByText('309 variables', { exact: true })).toBeVisible();

  // The grid scrolls inside its own box, and virtualizes its rows while
  // doing so: that is the scroll effect to measure.
  const grid = page.getByRole('grid', { name: 'Variables' });
  const frames = await grid.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = [];
        const max = element.scrollHeight - element.clientHeight;
        let last = performance.now();
        const step = (now: number) => {
          deltas.push(now - last);
          last = now;
          element.scrollBy(0, 40);
          if (element.scrollTop >= max || deltas.length >= 300)
            resolve(deltas.slice(1));
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  expect(frames.length).toBeGreaterThan(30);
  // A frame over 50ms is a visible hitch (three missed frames at 60Hz). CI
  // machines are shared and slow, so this allows up to 10% of such frames:
  // loose enough not to flake, tight enough to catch scroll handlers or
  // effects that janks every frame.
  const slow = frames.filter((delta) => delta > 50).length;
  expect(slow / frames.length).toBeLessThan(0.1);
});
