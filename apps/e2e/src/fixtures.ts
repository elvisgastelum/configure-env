// The Playwright fixtures every journey uses: `served`, a running
// `configure-env serve` over a fresh copy of a fixture project (one per
// test, so tests run in parallel without sharing files or ports), and
// `portal`, the page already signed in through the launch URL.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import {
  copyFixture,
  removeFixture,
  startServe,
  type FixtureName,
  type Served,
} from './serve.ts';

export interface Project extends Served {
  /** Reads a project file as text. */
  read: (path: string) => Promise<string>;
  /** Writes a project file, as an editor or another tool would. */
  write: (path: string, text: string) => Promise<void>;
  /** Reads env.schema.json. */
  schema: () => Promise<SchemaDocument>;
}

export interface SchemaDocument {
  variables: Record<string, Record<string, unknown>>;
  files: { path: string; variables: string[] | '*'; [key: string]: unknown }[];
}

interface Fixtures {
  /** The fixture project the test serves; `portfolio` unless a test says. */
  fixture: FixtureName;
  served: Project;
  /** The portal, opened through the launch URL so the tab holds the cookie. */
  portal: Page;
}

export const test = base.extend<Fixtures>({
  fixture: ['portfolio', { option: true }],
  served: async ({ fixture }, use) => {
    const dir = await copyFixture(fixture);
    const served = await startServe(dir).catch(async (error: unknown) => {
      await removeFixture(dir);
      throw error;
    });
    const project: Project = {
      ...served,
      read: (path) => readFile(join(dir, path), 'utf8'),
      write: (path, text) => writeFile(join(dir, path), text),
      schema: async () =>
        JSON.parse(
          await readFile(join(dir, 'env.schema.json'), 'utf8'),
        ) as SchemaDocument,
    };
    try {
      await use(project);
    } finally {
      await served.stop();
      await removeFixture(dir);
    }
  },
  portal: async ({ page, served }, use) => {
    // The portal opens the event stream once it renders, and the server
    // answers it once it watches the files. A test that edits a file or
    // drops the cookie before then would race it: the edit sends no event,
    // or the stream never opens without the cookie.
    const events = page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/events' && response.ok(),
      )
      .then(
        () => undefined,
        (error: unknown) =>
          new Error(`the portal never opened /api/events: ${String(error)}`),
      );
    await page.goto(served.launchUrl);
    // The launch route sets the session cookie and moves to the overview;
    // the navigation may sit behind "Open navigation" on a narrow screen.
    await expect(page).toHaveURL(`${served.origin}/`);
    await expect(page.locator('main#main')).toBeVisible();
    // Settled either way, so a failure above never leaves it unhandled.
    const failed = await events;
    if (failed) throw failed;
    await use(page);
  },
});

export { expect };

/** The value of `name` in a dotenv text, or undefined when it has no line. */
export function dotenvValue(text: string, name: string): string | undefined {
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(
      line,
    );
    if (match?.[1] === name) return match[2]!.trim().replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}
