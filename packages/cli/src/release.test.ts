// Releases are tagged `@elvisgastelum/configure-env@X.Y.Z`: Changesets tags
// each published workspace package as `<name>@<version>`. That holds only
// while this package is the one public package and private packages are never
// tagged, so pin those settings and the documented format together.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO = new URL('../../../', import.meta.url);
const PACKAGE = new URL('../', import.meta.url);

function json(path: string, base: URL): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, base), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('release tags', () => {
  const cli = json('package.json', PACKAGE);
  const tag = `${String(cli.name)}@`;

  it('publishes the cli as the only public package', () => {
    expect(cli.name).toBe('@elvisgastelum/configure-env');
    expect(cli.private).not.toBe(true);
    for (const group of ['apps', 'packages']) {
      const dir = new URL(`${group}/`, REPO);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const manifest = new URL(`${name}/package.json`, dir);
        if (!existsSync(manifest)) continue;
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string;
          private?: boolean;
        };
        if (pkg.name !== cli.name) expect(pkg.private, pkg.name).toBe(true);
      }
    }
  });

  it('never versions or tags private packages', () => {
    expect(json('package.json', REPO).private).toBe(true);
    expect(json('.changeset/config.json', REPO).privatePackages).toEqual({
      version: false,
      tag: false,
    });
  });

  it('documents the tag format', () => {
    const readme = readFileSync(new URL('README.md', REPO), 'utf8');
    const workflow = readFileSync(
      new URL('.github/workflows/release.yml', REPO),
      'utf8',
    );
    expect(readme).toContain(`\`${tag}X.Y.Z\``);
    expect(workflow).toContain(`${tag}X.Y.Z`);
  });
});
