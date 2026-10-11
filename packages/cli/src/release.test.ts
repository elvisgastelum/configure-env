// Releases are tagged `@elvisgastelum/configure-env@X.Y.Z`: Changesets tags
// each published workspace package as `<name>@<version>`. That holds only
// while this package is the one public package and private packages are never
// tagged, so pin those settings and the documented format together.

import { readFileSync } from 'node:fs';
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

  it('publishes the cli as the public package', () => {
    expect(cli.name).toBe('@elvisgastelum/configure-env');
    expect(cli.private).toBeUndefined();
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
