// Releases are tagged `@elvisgastelum/configure-env@X.Y.Z`: Changesets tags
// each published workspace package as `<name>@<version>`. That holds only
// while this package is the one public package and private packages are never
// tagged, so pin those settings and the documented format together.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT as REPO } from './cli/test-helpers.ts';

const PACKAGE = new URL('../', import.meta.url);

/** The `packages:` globs of pnpm-workspace.yaml, such as `apps/*`. */
function workspaceGlobs(): string[] {
  const yaml = readFileSync(new URL('pnpm-workspace.yaml', REPO), 'utf8');
  const block = /^packages:\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(yaml);
  if (!block?.[1]) throw new Error('pnpm-workspace.yaml has no packages list');
  return [...block[1].matchAll(/-\s*['"]?([^'"\s]+)/g)].map((m) => m[1]!);
}

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
    const globs = workspaceGlobs();
    expect(globs.length).toBeGreaterThan(0);
    for (const glob of globs) {
      // Every glob is one directory level: `<group>/*`.
      expect(glob, glob).toMatch(/^[\w.-]+\/\*$/);
      const dir = new URL(glob.slice(0, -1), REPO);
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
