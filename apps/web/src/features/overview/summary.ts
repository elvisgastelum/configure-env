// What the overview shows, computed from the API's answers.

import type { Check, FileInfo, Variables } from '@configure-env/api-client';

export interface VariableCounts {
  variables: number;
  secrets: number;
  required: number;
  groups: number;
}

export function countVariables({ variables }: Variables): VariableCounts {
  const groups = new Set(
    variables.flatMap(({ spec }) => (spec.group ? [spec.group] : [])),
  );
  return {
    variables: variables.length,
    secrets: variables.filter(({ spec }) => spec.secret).length,
    required: variables.filter(({ spec }) => spec.required).length,
    groups: groups.size,
  };
}

/** The errors check reports: its files' errors and the plan's own. */
export function checkErrors(check: Check): number {
  if (check.ok) return 0;
  return Math.max(1, check.summary.errors + check.errors.length);
}

export type ModeState =
  | { kind: 'none' }
  | { kind: 'ok'; mode: string }
  | { kind: 'mismatch'; actual: string; expected: string };

/** The file's mode against the schema's, when either is known. */
export function modeState({ mode, exists }: FileInfo): ModeState {
  if (!exists || mode.actual === null) return { kind: 'none' };
  if (mode.expected !== null && mode.expected !== mode.actual)
    return { kind: 'mismatch', actual: mode.actual, expected: mode.expected };
  return { kind: 'ok', mode: mode.actual };
}
