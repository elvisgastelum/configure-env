// Reads and validates an env schema file; the checks themselves are in
// parse.ts, which this module re-exports.

import { readFile } from 'node:fs/promises';
import { type SchemaResult, parseSchemaText } from './parse.ts';

export * from './parse.ts';

export const DEFAULT_SCHEMA_PATH = 'env.schema.json';

/** Reads, parses and validates the schema file at `path`. */
export async function loadSchema(
  path: string = DEFAULT_SCHEMA_PATH,
): Promise<SchemaResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return {
      ok: false,
      errors: [{ path: '(root)', message: `cannot read ${path}: ${code}` }],
    };
  }
  return parseSchemaText(text);
}
