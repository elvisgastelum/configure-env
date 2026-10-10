import { type ExampleKey, renderExampleBlock } from './template.ts';

/** One line of an env file; `key` and `value` are set for `KEY=value` lines. */
export interface EnvLine {
  raw: string;
  key?: string;
  value?: string;
}

const PAIR = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Splits env file content into lines, reading `KEY=value` pairs. */
export function parse(content: string): EnvLine[] {
  if (!content) return [];
  const lines = content.split('\n');
  // A trailing newline ends the last line; it does not start another.
  if (lines.at(-1) === '') lines.pop();
  return lines.map((raw) => {
    const match = PAIR.exec(raw);
    return match ? { raw, key: match[1], value: match[2] } : { raw };
  });
}

/** The required keys `content` lacks (no `KEY=` line), in order. */
export function missingKeys(
  content: string,
  required: readonly ExampleKey[],
): ExampleKey[] {
  const present = new Set(parse(content).map((line) => line.key));
  return required.filter((key) => !present.has(key));
}

/**
 * Keeps every existing line and appends the missing keys with their
 * comments: an unterminated last line is ended first, and a non-empty file
 * gets a blank line before the block.
 */
export function mergeMissingKeys(
  existing: string,
  required: readonly ExampleKey[],
): { content: string; added: ExampleKey[] } {
  const added = missingKeys(existing, required);
  if (!added.length) return { content: existing, added };
  let content = existing;
  if (content && !content.endsWith('\n')) content += '\n';
  if (content) content += '\n';
  return { content: content + renderExampleBlock(added), added };
}
