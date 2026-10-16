// A line diff of two texts for a side-by-side view: Myers' algorithm over
// the lines between the common head and tail, with each removed run paired
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

/** The edit script turning `a` into `b`, shortest first (Myers, 1986). */
function myers(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Array<number>(2 * max + 3).fill(0);
  const trace: number[][] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, offset);
    }
  }
  return [];
}

function backtrack(
  trace: number[][],
  n: number,
  m: number,
  offset: number,
): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const previousK =
      k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
        ? k + 1
        : k - 1;
    const previousX = v[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      ops.push('same');
      x--;
      y--;
    }
    if (d === 0) break;
    ops.push(x === previousX ? 'added' : 'removed');
    x = previousX;
    y = previousY;
  }
  return ops.reverse();
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
    while (ops[index] === 'removed') {
      removed.push(at(a, left++));
      index++;
    }
    while (ops[index] === 'added') {
      added.push(at(b, right++));
      index++;
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
 * The rows with each unchanged stretch longer than twice `context` folded,
 * keeping `context` rows next to every change.
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
