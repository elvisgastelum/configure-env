// Where the package's own files are: its package.json and the skill it
// ships. The sources run from src/cli and the bundle from dist, so the path
// is found, not assumed.

import { existsSync } from 'node:fs';

/** The nearest directory holding a package.json, up from this module. */
function findPackageRoot(from: URL): URL {
  for (let dir = new URL('.', from); ; dir = new URL('..', dir)) {
    if (existsSync(new URL('package.json', dir))) return dir;
    if (dir.pathname === '/')
      throw new Error(`no package.json above ${from.pathname}`);
  }
}

/** The package directory, as a URL ending in `/`. */
export const PACKAGE_ROOT = findPackageRoot(new URL(import.meta.url));
