// The browser-safe entry (`@configure-env/core/schema`) must never reach a
// Node built-in or a package other than zod, so the portal can bundle it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as entry from './schema.ts';

const IMPORT = /^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm;

/** Every module the file imports at run time, transitively, by resolved path. */
function importGraph(file: string, seen = new Map<string, string[]>()) {
  if (seen.has(file)) return seen;
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(IMPORT)]
    // `import type` and `export type` leave nothing at run time.
    .filter((match) => !/^\s*(?:import|export)\s+type\b/.test(match[0]))
    .map((match) => match[1]!);
  seen.set(file, specifiers);
  for (const specifier of specifiers)
    if (specifier.startsWith('.'))
      importGraph(resolve(dirname(file), specifier), seen);
  return seen;
}

describe('@configure-env/core/schema', () => {
  it('imports no Node built-in and no package but zod', () => {
    const root = fileURLToPath(new URL('./schema.ts', import.meta.url));
    const external = [...importGraph(root).entries()].flatMap(
      ([file, specifiers]) =>
        specifiers
          .filter((specifier) => !specifier.startsWith('.'))
          .filter((specifier) => specifier !== 'zod')
          .map((specifier) => `${file}: ${specifier}`),
    );
    expect(external).toEqual([]);
  });

  it('exports the definitions, the checks and the writer edits', () => {
    for (const name of [
      'envSchema',
      'variableSpec',
      'fileSpec',
      'VARIABLE_TYPES',
      'VARIABLE_NAME',
      'filePathProblem',
      'isTemplate',
      'validateValue',
      'parseSchema',
      'formatIssuePath',
      'addVariable',
      'updateVariable',
      'renameVariable',
      'removeVariable',
      'reorderVariables',
      'addFile',
      'updateFile',
      'removeFile',
      'findReferences',
      'variableReferences',
      'formatJson',
    ])
      expect(entry).toHaveProperty(name);
  });
});
