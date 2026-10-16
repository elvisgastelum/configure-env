// The plan as the apply flow reads it: which files it writes, and each
// file's diff as the schema diff's rows, so its folding is reused.

import type { DiffLine as PlanLine, FilePlan } from '@configure-env/api-client';
import type { DiffRow } from '../schema/diff';

/** The actions that write a file. */
const WRITES: readonly FilePlan['action'][] = ['create', 'update', 'mode'];

/** Whether applying writes `file`. */
export const writes = (file: FilePlan) => WRITES.includes(file.action);

/** A plan's lines as the schema diff's rows, numbered on each side. */
export function rowsOf(lines: readonly PlanLine[]): DiffRow[] {
  let left = 0;
  let right = 0;
  return lines.map(({ kind, line }): DiffRow => {
    if (kind === 'removed') return { kind, left: { line: ++left, text: line } };
    if (kind === 'added') return { kind, right: { line: ++right, text: line } };
    return {
      kind,
      left: { line: ++left, text: line },
      right: { line: ++right, text: line },
    };
  });
}
