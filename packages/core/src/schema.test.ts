// The browser-safe entry (`@configure-env/core/schema`) must never reach a
// Node built-in or a package other than zod, so the portal can bundle it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vite-plus/test';
import * as entry from './schema.ts';

/**
 * The modules a source imports at run time: static imports and re-exports,
 * side-effect imports and dynamic import(). Type-only imports and exports
 * leave nothing at run time.
 */
function runtimeSpecifiers(text: string): string[] {
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      // A computed specifier cannot be checked, so it counts as unknown.
      specifiers.push(
        argument && ts.isStringLiteralLike(argument)
          ? argument.text
          : '(computed import)',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** Every module the file imports at run time, transitively, by resolved path. */
function importGraph(file: string, seen = new Map<string, string[]>()) {
  if (seen.has(file)) return seen;
  const specifiers = runtimeSpecifiers(readFileSync(file, 'utf8'));
  seen.set(file, specifiers);
  for (const specifier of specifiers)
    if (specifier.startsWith('.'))
      importGraph(resolve(dirname(file), specifier), seen);
  return seen;
}

describe('runtimeSpecifiers', () => {
  it.each([
    ["import { readFileSync } from 'node:fs';", ['node:fs']],
    ["import 'node:fs';", ['node:fs']],
    ["const fs = await import('node:fs');", ['node:fs']],
    ['const fs = await import(name);', ['(computed import)']],
    ["export { join } from 'node:path';", ['node:path']],
    ["export * from 'node:path';", ['node:path']],
    ["import type { Stats } from 'node:fs';", []],
    ["export type { Stats } from 'node:fs';", []],
    // A type export with no quotes must not swallow a later runtime import.
    [
      "export type Mode = 'a' | 'b';\nexport type Pair = [Mode, Mode];\nimport { readFileSync } from 'node:fs';",
      ['node:fs'],
    ],
    ["export type Stats = number;\nimport 'node:os';", ['node:os']],
  ])('finds the run-time imports of %j', (text, expected) => {
    expect(runtimeSpecifiers(text)).toEqual(expected);
  });
});

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
