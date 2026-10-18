// The commands that work on a project do it through the configure-env API
// (connect.ts), so --env reaches any environment: none reads or writes a
// project with @configure-env/core itself. Only install, serve and the mcp
// process use the core directly.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';

const dir = new URL('./', import.meta.url);
const source = (file: string) => readFile(new URL(file, dir), 'utf8');

/** The commands that use the core directly, by design. */
const DIRECT = new Set(['install', 'serve', 'mcp']);

/**
 * What a command may still take from the core: types, and these values,
 * which read and write nothing.
 */
const PURE = new Set([
  'DEFAULT_EXAMPLE',
  'STATE_IGNORE',
  'VARIABLE_NAME',
  'VARIABLE_TYPES',
  'displayPath',
  'isTemplate',
  'maskValue',
  'parsePairs',
  'validateValue',
]);

/** The helpers of common.ts that do project work with the core. */
const PROJECT_HELPERS = ['recordRun', 'loadContextSchema'];

/** Each command's module, as main.ts imports and names it. */
async function commandModules(): Promise<Map<string, string>> {
  const main = await source('main.ts');
  const modules = new Map<string, string>();
  for (const [, names, file] of main.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.ts)'/g,
  ))
    for (const name of names!.split(',').map((part) => part.trim()))
      if (name.endsWith('Command')) modules.set(name, file!);
  const commands = new Map<string, string>();
  const table = /COMMANDS[^{]*\{([^}]*)\}/.exec(main)?.[1] ?? '';
  for (const [, command, handler] of table.matchAll(/(\w+):\s*(\w+)/g))
    commands.set(command!, modules.get(handler!)!);
  return commands;
}

/** The value imports (and re-exports) a source takes from `from`. */
function valuesFrom(text: string, from: string): string[] {
  const escaped = from.replace(/[/.]/g, '\\$&');
  const pattern = new RegExp(
    `(?:import|export)\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*'${escaped}'`,
    'g',
  );
  const names: string[] = [];
  for (const [, typeOnly, list] of text.matchAll(pattern)) {
    if (typeOnly) continue;
    for (const part of list!.split(',').map((item) => item.trim()))
      if (part && !part.startsWith('type '))
        names.push(part.split(/\s+as\s+/)[0]!);
  }
  if (new RegExp(`import\\s+(?:\\*|\\w+)[^{]*from\\s*'${escaped}'`).test(text))
    names.push('*');
  return names;
}

describe('the commands that run over the API', () => {
  it('finds every command main.ts runs', async () => {
    const commands = await commandModules();
    expect([...commands.keys()].sort()).toEqual(
      [
        'apply',
        'check',
        'env',
        'get',
        'history',
        'init',
        'install',
        'list',
        'mcp',
        'serve',
        'set',
        'unset',
      ].sort(),
    );
    for (const file of commands.values()) expect(file).toMatch(/\.ts$/);
  });

  it('import nothing from @configure-env/core that works on a project', async () => {
    const offending: string[] = [];
    for (const [command, file] of await commandModules()) {
      if (DIRECT.has(command)) continue;
      const text = await source(file);
      for (const name of valuesFrom(text, '@configure-env/core'))
        if (!PURE.has(name)) offending.push(`${command} (${file}): ${name}`);
      for (const name of valuesFrom(text, './common.ts'))
        if (PROJECT_HELPERS.includes(name))
          offending.push(`${command} (${file}): ${name} from common.ts`);
    }
    expect(offending).toEqual([]);
  });
});
