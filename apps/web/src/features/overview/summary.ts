// What the overview shows, computed from the API's answers.

import type {
  Check,
  FileInfo,
  Validate,
  Variables,
} from '@configure-env/api-client';

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

/** The problems check reports: plan errors and files that drift or break. */
export function checkIssues(check: Check): number {
  if (check.ok) return 0;
  const files = check.files.filter(
    (file) =>
      file.drift ||
      file.invalid.length > 0 ||
      file.rules.length > 0 ||
      file.error !== undefined,
  ).length;
  return Math.max(1, check.errors.length + files);
}

/** The errors validate reports across every file. */
export function validateErrors(validate: Validate): number {
  if (validate.ok) return 0;
  const errors = validate.files.reduce(
    (sum, file) => sum + file.errors.length,
    0,
  );
  return Math.max(1, errors);
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
