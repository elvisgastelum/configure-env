// Values as an env file writes them, for copying: the same quoting rules as
// the core's formatValue (packages/core/src/schema/values.ts), which the
// browser cannot import (the core reads files and opens SQLite).

// Whitespace, comment markers, quote characters and `$` would change how an
// env file reader splits, unquotes or interpolates the value.
const NEEDS_QUOTES = /[\s#"'`$]/;
// Single quotes hold a value literally, but not a single quote or a newline.
const SINGLE_QUOTE_UNSAFE = /['\n\r]/;
const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  $: '\\$',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/**
 * The value as written after `KEY=`: as is when plain; single-quoted when it
 * holds `$`; otherwise, or when single quotes cannot hold it, double-quoted
 * with backslash escapes.
 */
export function quoteValue(text: string): string {
  if (!NEEDS_QUOTES.test(text)) return text;
  if (text.includes('$') && !SINGLE_QUOTE_UNSAFE.test(text)) return `'${text}'`;
  return `"${text.replace(/[\\"$\n\r\t]/g, (char) => ESCAPES[char] ?? char)}"`;
}

/** `KEY=VALUE`, or `export KEY=VALUE` for a shell. */
export const dotenvLine = (key: string, value: string, exported = false) =>
  `${exported ? 'export ' : ''}${key}=${quoteValue(value)}`;

/** Lines of an env file, each ended by a newline. */
export const dotenvOf = (entries: readonly (readonly [string, string])[]) =>
  entries.map(([key, value]) => `${dotenvLine(key, value)}\n`).join('');
