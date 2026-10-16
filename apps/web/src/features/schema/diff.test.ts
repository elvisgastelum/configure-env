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
});

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

  it('folds nothing when every row is near a change', () => {
    const items = foldRows(diffLines('a\nb\nc', 'a\nB\nc'), 3);
    expect(items).toHaveLength(3);
  });
});
