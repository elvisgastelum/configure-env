import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

/*
 * The package must stand on its own so it can be extracted or reused: no
 * file under `src` may reach into an app, through the app's `@/` alias or a
 * relative path that leaves the package. Components take their copy and
 * their links from the app through props, so nothing imports i18n or a
 * router either.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const SRC = join(PACKAGE_ROOT, 'src');
const SELF = resolve(import.meta.filename);

const SOURCE_FILE = /\.(ts|tsx|mdx|css)$/;
/** `from '…'`, `import '…'`, `import('…')` and CSS `@import '…'` specifiers. */
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
/** Translation and routing belong to the app, not to its design system. */
const APP_RUNTIME = /^(react-i18next|i18next|@tanstack\/react-router)(\/|$)/;

const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .map((path) => join(SRC, path))
  .filter((path) => SOURCE_FILE.test(path) && path !== SELF);

function specifiers(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(SPECIFIER)].flatMap((match) => match[1] ?? []);
}

describe('package boundary', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((path) => [relative(SRC, path), path]))(
    '%s imports nothing from an app',
    (_name, path) => {
      for (const specifier of specifiers(path)) {
        expect(specifier, `${specifier} uses the app's @/ alias`).not.toMatch(
          /^@\//,
        );
        expect(specifier, `${specifier} points into apps/`).not.toMatch(
          /(^|\/)apps\//,
        );
        expect(
          specifier,
          `${specifier} ties the package to the app's i18n or router`,
        ).not.toMatch(APP_RUNTIME);
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(path), specifier);
          expect(
            target.startsWith(PACKAGE_ROOT + sep),
            `${specifier} leaves the package`,
          ).toBe(true);
        }
      }
    },
  );
});
