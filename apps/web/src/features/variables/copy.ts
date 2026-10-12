// Copying values to the clipboard. A secret is revealed through the API for
// the copy and kept nowhere: not in the query cache, not on screen.

import type { Variable } from '@configure-env/api-client';
import { dotenvLine, dotenvOf } from './dotenv';
import { plainValueOf } from './secrets';

export type CopyFormat = 'value' | 'pair' | 'export';
export const COPY_FORMATS: readonly CopyFormat[] = ['value', 'pair', 'export'];

/** The variable has no value in the file to copy. */
export class NothingToCopy extends Error {
  constructor(
    readonly key: string,
    readonly file: string,
  ) {
    super(`${key} is not set in ${file}`);
    this.name = 'NothingToCopy';
  }
}

export const writeClipboard = (text: string) =>
  navigator.clipboard.writeText(text);

/** The text of one value in `format`. */
export async function variableText(
  variable: Variable,
  file: string,
  format: CopyFormat,
): Promise<string> {
  const value = await plainValueOf(variable, file);
  if (value === undefined) throw new NothingToCopy(variable.name, file);
  if (format === 'value') return value;
  return dotenvLine(variable.name, value, format === 'export');
}

/**
 * `variables`' values in `file` as an env file, in the given order; the
 * ones not set there are left out.
 */
export async function dotenvText(
  variables: readonly Variable[],
  file: string,
): Promise<{ text: string; count: number }> {
  const values = await Promise.all(
    variables.map(async (variable) => {
      const value = await plainValueOf(variable, file);
      return value === undefined ? [] : [[variable.name, value] as const];
    }),
  );
  const entries = values.flat();
  return { text: dotenvOf(entries), count: entries.length };
}
