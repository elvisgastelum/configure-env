// A line diff of two texts for a side-by-side view: Myers' algorithm, in
// linear space, over the lines between the common head and tail, with each removed run paired
// with the added run that replaces it, and long unchanged stretches folded.

export interface DiffLine {
  /** 1-based, on its own side. */
  line: number;
  text: string;
}

export interface DiffRow {
  kind: 'same' | 'removed' | 'added' | 'changed';
  left?: DiffLine;
  right?: DiffLine;
}

type Op = 'same' | 'removed' | 'added';

/**
 * The edit script turning `a` into `b`, shortest first (Myers, 1986), in
 * linear space: each step finds the middle of a shortest path and diffs the
 * two halves on their own, so memory stays O(n + m) however scattered the
 * edits are, and time O((n + m) D).
 */
function myers(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = [];
  diffRange(a, 0, a.length, b, 0, b.length, ops);
  return ops;
}

/** Appends the script turning `a[aLo..aHi)` into `b[bLo..bHi)` to `ops`. */
function diffRange(
  a: readonly string[],
  aLo: number,
  aHi: number,
  b: readonly string[],
  bLo: number,
  bHi: number,
  ops: Op[],
): void {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    ops.push('same');
    aLo++;
    bLo++;
  }
  let tail = 0;
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
    tail++;
  }
  if (aLo === aHi) for (let y = bLo; y < bHi; y++) ops.push('added');
  else if (bLo === bHi) for (let x = aLo; x < aHi; x++) ops.push('removed');
  else {
    const split = middle(a, aLo, aHi, b, bLo, bHi);
    if (split) {
      diffRange(a, aLo, split.x, b, bLo, split.y, ops);
      diffRange(a, split.x, aHi, b, split.y, bHi, ops);
    } else {
      // Nothing in common: every line is replaced.
      for (let x = aLo; x < aHi; x++) ops.push('removed');
      for (let y = bLo; y < bHi; y++) ops.push('added');
    }
  }
  for (let index = 0; index < tail; index++) ops.push('same');
}

/**
 * A point on a shortest path through the two ranges, found by searching
 * from both ends at once until the paths meet; undefined when the ranges
 * share no line. Both ranges are non-empty.
 */
function middle(
  a: readonly string[],
  aLo: number,
  aHi: number,
  b: readonly string[],
  bLo: number,
  bHi: number,
): { x: number; y: number } | undefined {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD + 2;
  // The furthest x reached on each diagonal, forward and backward.
  const forward = new Int32Array(size).fill(-1);
  const backward = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  backward[offset + 1] = 0;
  const delta = n - m;
  // With an odd delta the forward search meets the backward one first.
  const front = delta % 2 !== 0;
  // Diagonals that ran off the edge are skipped from then on.
  let k1Start = 0;
  let k1End = 0;
  let k2Start = 0;
  let k2End = 0;
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1Start; k1 <= d - k1End; k1 += 2) {
      const at = offset + k1;
      let x1 =
        k1 === -d || (k1 !== d && forward[at - 1]! < forward[at + 1]!)
          ? forward[at + 1]!
          : forward[at - 1]! + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      forward[at] = x1;
      if (x1 > n) k1End += 2;
      else if (y1 > m) k1Start += 2;
      else if (front) {
        const other = offset + delta - k1;
        if (other >= 0 && other < size && backward[other] !== -1) {
          if (x1 >= n - backward[other]!) return { x: aLo + x1, y: bLo + y1 };
        }
      }
    }
    for (let k2 = -d + k2Start; k2 <= d - k2End; k2 += 2) {
      const at = offset + k2;
      let x2 =
        k2 === -d || (k2 !== d && backward[at - 1]! < backward[at + 1]!)
          ? backward[at + 1]!
          : backward[at - 1]! + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - 1 - x2] === b[bHi - 1 - y2]) {
        x2++;
        y2++;
      }
      backward[at] = x2;
      if (x2 > n) k2End += 2;
      else if (y2 > m) k2Start += 2;
      else if (!front) {
        const other = offset + delta - k2;
        if (other >= 0 && other < size && forward[other] !== -1) {
          const x1 = forward[other]!;
          const y1 = offset + x1 - other;
          if (x1 >= n - x2) return { x: aLo + x1, y: bLo + y1 };
        }
      }
    }
  }
  return undefined;
}

/** The rows of a side-by-side diff of `before` and `after`, line by line. */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const ops: Op[] = [
    ...Array<Op>(head).fill('same'),
    ...myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...Array<Op>(tail).fill('same'),
  ];

  const rows: DiffRow[] = [];
  let left = 0;
  let right = 0;
  const at = (lines: string[], index: number): DiffLine => ({
    line: index + 1,
    text: lines[index]!,
  });
  for (let index = 0; index < ops.length;) {
    if (ops[index] === 'same') {
      rows.push({ kind: 'same', left: at(a, left++), right: at(b, right++) });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    // The halves of the linear-space search may leave an added line before
    // a removed one in the same run; the run is paired as a whole.
    for (; index < ops.length && ops[index] !== 'same'; index++) {
      if (ops[index] === 'removed') removed.push(at(a, left++));
      else added.push(at(b, right++));
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
      const old = removed[pair];
      const next = added[pair];
      rows.push(
        old && next
          ? { kind: 'changed', left: old, right: next }
          : old
            ? { kind: 'removed', left: old }
            : { kind: 'added', right: next },
      );
    }
  }
  return rows;
}

/** A run of unchanged rows folded away. */
export interface FoldedRows {
  skipped: number;
}

/**
 * The rows with every unchanged row more than `context` rows from a change
 * folded, a run of them at a time; a run of one row is kept, since folding
 * it would hide nothing.
 */
export function foldRows(
  rows: readonly DiffRow[],
  context = 3,
): (DiffRow | FoldedRows)[] {
  const near = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === 'same') return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    for (let at = from; at <= to; at++) near[at] = true;
  });
  const items: (DiffRow | FoldedRows)[] = [];
  let runStart = 0;
  const flush = (end: number) => {
    // A fold of a single row hides nothing worth hiding.
    if (end - runStart === 1) items.push(rows[runStart]!);
    else if (end > runStart) items.push({ skipped: end - runStart });
  };
  rows.forEach((row, index) => {
    if (!near[index]) return;
    flush(index);
    items.push(row);
    runStart = index + 1;
  });
  flush(rows.length);
  return items;
}
