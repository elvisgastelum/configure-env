// The line diff a plan shows for each file, with every secret masked: the
// portal previews a change without ever receiving a secret value.

import { type EnvSchema, maskValue, parseDotenv } from '@configure-env/core';

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  line: string;
}

/** A logical line: its exact text, and the lines it shows as. */
interface Shown {
  raw: string;
  shown: string[];
}

/** The text's logical lines, each shown with a secret entry's value masked. */
function shownLines(schema: EnvSchema, text: string): Shown[] {
  if (!text) return [];
  return parseDotenv(text).lines.map((line) => {
    const spec = line.key ? schema.variables[line.key] : undefined;
    let shown = line.raw;
    if (
      line.kind === 'entry' &&
      spec?.secret &&
      line.valueStart !== undefined &&
      line.valueEnd !== undefined
    )
      shown =
        line.raw.slice(0, line.valueStart) +
        maskValue(spec, line.value ?? '') +
        line.raw.slice(line.valueEnd);
    return { raw: line.raw, shown: shown.split(/\r?\n/) };
  });
}

/** The text's lines as shown: a secret entry's value masked. */
export const maskedLines = (schema: EnvSchema, text: string): string[] =>
  shownLines(schema, text).flatMap((line) => line.shown);

/** The longest common subsequence diff of two line lists. */
export function diffLines(
  before: readonly string[],
  after: readonly string[],
): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // lengths[i][j]: the LCS length of before[i..] and after[j..].
  const lengths = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lengths[i]![j] =
        before[i] === after[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      diff.push({ kind: 'same', line: before[i]! });
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
      diff.push({ kind: 'removed', line: before[i++]! });
    else diff.push({ kind: 'added', line: after[j++]! });
  }
  while (i < n) diff.push({ kind: 'removed', line: before[i++]! });
  while (j < m) diff.push({ kind: 'added', line: after[j++]! });
  return diff;
}

/**
 * The masked diff from `previous` to `content`; undefined text is empty.
 * Lines are compared as written, so a changed secret shows as removed and
 * added even when its masks look alike.
 */
export function fileDiff(
  schema: EnvSchema,
  previous: string | undefined,
  content: string | undefined,
): DiffLine[] {
  const before = shownLines(schema, previous ?? '');
  const after = shownLines(schema, content ?? '');
  const shownOf = new Map<string, string[]>();
  for (const line of [...before, ...after]) shownOf.set(line.raw, line.shown);
  return diffLines(
    before.map((line) => line.raw),
    after.map((line) => line.raw),
  ).flatMap(({ kind, line }) =>
    shownOf.get(line)!.map((shown) => ({ kind, line: shown })),
  );
}
