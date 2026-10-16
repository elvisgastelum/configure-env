import { describe, expect, it } from 'vitest';
import { type DiffRow, diffLines, foldRows } from './diff';

/** A row as `kind left | right`, for short expectations. */
const show = (rows: DiffRow[]) =>
  rows.map(
    (row) => `${row.kind} ${row.left?.text ?? '-'} | ${row.right?.text ?? '-'}`,
  );

describe('diffLines', () => {
  it('pairs every line of equal texts', () => {
    const rows = diffLines('a\nb', 'a\nb');
    expect(show(rows)).toEqual(['same a | a', 'same b | b']);
    expect(rows[1]).toEqual({
      kind: 'same',
      left: { line: 2, text: 'b' },
      right: { line: 2, text: 'b' },
    });
  });

  it('shows added and removed lines on their own side', () => {
    expect(show(diffLines('a\nb\nc', 'a\nc\nd'))).toEqual([
      'same a | a',
      'removed b | -',
      'same c | c',
      'added - | d',
    ]);
  });

  it('pairs a removed run with the added run that replaces it', () => {
    expect(show(diffLines('a\nx\ny\nb', 'a\nX\nb'))).toEqual([
      'same a | a',
      'changed x | X',
      'removed y | -',
      'same b | b',
    ]);
  });

  it('numbers each side on its own', () => {
    const rows = diffLines('a\nb', 'z\na\nb');
    expect(rows.map((row) => [row.left?.line, row.right?.line])).toEqual([
      [undefined, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('diffs a large text with one change quickly', () => {
    const before = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[10_000] = 'changed';
    const rows = diffLines(before.join('\n'), after.join('\n'));
    expect(rows.filter((row) => row.kind !== 'same')).toHaveLength(1);
  });

  it('diffs a large text changed in many scattered places', () => {
    // A reorder preview of a large schema: thousands of edits spread over
    // the whole text, so trimming the common head and tail saves nothing.
    const before = Array.from({ length: 16_000 }, (_, i) => `line ${i}`);
    const after = before.map((line, i) => (i % 4 === 1 ? `moved ${i}` : line));
    const rows = diffLines(before.join('\n'), after.join('\n'));
    expect(sides(rows)).toEqual([before, after]);
    expect(rows.filter((row) => row.kind === 'changed')).toHaveLength(4000);
    expect(rows.filter((row) => row.kind === 'same')).toHaveLength(12_000);
  });

  it('finds a shortest edit for every small pair of texts', () => {
    // A seeded generator, so a failure names the texts it failed on.
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const text = () =>
      Array.from({ length: Math.floor(random() * 9) }, () =>
        'abc'.charAt(Math.floor(random() * 3)),
      );
    for (let run = 0; run < 500; run++) {
      const a = text();
      const b = text();
      const rows = diffLines(a.join('\n'), b.join('\n'));
      const label = `${a.join('')} -> ${b.join('')}`;
      expect(sides(rows), label).toEqual([
        a.length ? a : [''],
        b.length ? b : [''],
      ]);
      const same = rows.filter((row) => row.kind === 'same').length;
      expect(same, label).toBe(
        longestCommon(a.length ? a : [''], b.length ? b : ['']),
      );
    }
  });
});

/** The texts of each side of the rows, in order. */
function sides(rows: DiffRow[]): [string[], string[]] {
  const left = rows.flatMap((row) => (row.left ? [row.left.text] : []));
  const right = rows.flatMap((row) => (row.right ? [row.right.text] : []));
  return [left, right];
}

/** The length of the longest common subsequence, by dynamic programming. */
function longestCommon(a: string[], b: string[]): number {
  const table = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      table[i]![j] =
        a[i - 1] === b[j - 1]
          ? table[i - 1]![j - 1]! + 1
          : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
  return table[a.length]![b.length]!;
}

describe('foldRows', () => {
  it('keeps the context around changes and folds the rest', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'L10');
    const items = foldRows(diffLines(before, after), 2);
    expect(
      items.map((item) =>
        'skipped' in item ? `skip ${item.skipped}` : item.kind,
      ),
    ).toEqual(['skip 8', 'same', 'same', 'changed', 'same', 'same', 'skip 7']);
  });

  it('folds a short stretch between two changes', () => {
    // Rows 4 and 5 are more than `context` rows from both changes.
    const before = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l1', 'L1').replace('l8', 'L8');
    const items = foldRows(diffLines(before, after), 2);
    expect(
      items.map((item) =>
        'skipped' in item ? `skip ${item.skipped}` : item.kind,
      ),
    ).toEqual([
      'same',
      'changed',
      'same',
      'same',
      'skip 2',
      'same',
      'same',
      'changed',
      'same',
    ]);
  });

  it('folds nothing when every row is near a change', () => {
    const items = foldRows(diffLines('a\nb\nc', 'a\nB\nc'), 3);
    expect(items).toHaveLength(3);
  });
});
