// The check report as the page lists it: each file's problems errors first,
// the severity filter the page keeps in its address, and where a problem
// opens in the editor.

import type {
  Check,
  FileCheck,
  OpenInEditorRequest,
  Problem,
  ProblemSeverity,
} from '@configure-env/api-client';

/** `/check?severity=`: the problems to show; every one when absent. */
export interface CheckSearch {
  severity?: ProblemSeverity;
}

export function validateCheckSearch(
  search: Record<string, unknown>,
): CheckSearch {
  const { severity } = search;
  return severity === 'error' || severity === 'warning' ? { severity } : {};
}

/** The file's problems, errors first, each severity in the report's order. */
export const sortProblems = (problems: readonly Problem[]) => [
  ...problems.filter((problem) => problem.severity === 'error'),
  ...problems.filter((problem) => problem.severity === 'warning'),
];

/** The problems of `severity`, or every one. */
export const filterProblems = (
  problems: readonly Problem[],
  severity?: ProblemSeverity,
) =>
  severity
    ? problems.filter((problem) => problem.severity === severity)
    : [...problems];

/** How many problems of each severity the file has. */
export const countsOf = (problems: readonly Problem[]) => ({
  errors: problems.filter((problem) => problem.severity === 'error').length,
  warnings: problems.filter((problem) => problem.severity === 'warning').length,
});

/** Every key a problem names: a rule's keys, else its own key. */
export const keysOf = (problem: Problem) =>
  problem.keys ?? (problem.key ? [problem.key] : []);

/** Whether applying the file fixes some of its problems. */
export const applyFixes = (file: FileCheck) =>
  file.problems.some((problem) => problem.fix === 'apply');

/** Whether applying with prune removes some of its keys. */
export const pruneFixes = (file: FileCheck) =>
  file.problems.some((problem) => problem.fix === 'prune');

/** The files with an error, which the summary links to. */
export const failingFiles = (check: Check) =>
  check.files.filter((file) => !file.ok);

/**
 * Where a problem opens in the editor: a key at its entry, a bad line at its
 * line, the file's own problems at its top. Nothing for a file that does not
 * exist or whose path is refused.
 */
export function editorTargetOf(
  file: FileCheck,
  problem: Problem,
): OpenInEditorRequest | undefined {
  if (file.status === 'missing' || file.status === 'refused') return undefined;
  if (problem.line !== undefined)
    return { file: file.path, line: problem.line };
  if (problem.key) return { file: file.path, key: problem.key };
  return { file: file.path };
}
