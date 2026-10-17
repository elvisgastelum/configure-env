// How plans, results and check reports read, as plain lines and as JSON.

import {
  type ApplyResult,
  type CheckProblem,
  type CheckReport,
  type GitignoreFix,
  type GitignoreProblem,
  type FileCheck,
  type FilePlan,
  formatMode,
} from '@configure-env/core';
import { protectedLine } from './protect.ts';

/** `644 → 600`: the file's mode before and after the run. */
const modeChange = (file: FilePlan) =>
  `${formatMode(file.currentMode!)} → ${formatMode(file.mode)}`;

/**
 * An update that adds or prunes keys, as `<added> keys: A B; <pruned> keys:
 * C, D`; undefined for any other.
 */
function keyChanges(file: FilePlan, added: string, pruned: string) {
  const parts = [
    ...(file.policy === 'merge' && file.addedKeys.length
      ? [`${added} keys: ${file.addedKeys.join(' ')}`]
      : []),
    ...(file.prunedKeys?.length
      ? [`${pruned} keys: ${file.prunedKeys.join(', ')}`]
      : []),
  ];
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * What a run did to a file: `created`, `added keys: A B`, `pruned keys: C,
 * D`, ...
 */
export function applyStatus(file: FilePlan, result?: ApplyResult): string {
  if (result && !result.ok) return `failed (${result.error})`;
  switch (file.action) {
    case 'create':
      return 'created';
    case 'update':
      return keyChanges(file, 'added', 'pruned') ?? 'updated';
    case 'mode':
      return `mode fixed (${modeChange(file)})`;
    case 'unchanged':
      return 'unchanged';
    case 'skip':
      if (file.reason === 'loosens') return file.error!;
      return file.reason === 'exists'
        ? 'skipped (exists)'
        : `skipped (refused: ${file.error})`;
  }
}

/** A file's state before a run, for the file picker. */
export function fileState(file: FilePlan): string {
  if (file.reason === 'refused') return `refused: ${file.error}`;
  if (file.reason === 'loosens') return file.error!;
  if (file.reason === 'exists') return 'exists, never overwritten';
  if (file.previous === undefined) return 'missing';
  if (
    file.currentMode !== undefined &&
    file.modeFixed &&
    file.currentMode !== file.mode
  )
    return `mode ${formatMode(file.currentMode)}, expected ${formatMode(file.mode)}`;
  if (file.action === 'unchanged') return 'current';
  if (file.prunedKeys?.length) return keyChanges(file, 'missing', 'unknown')!;
  if (file.policy === 'merge')
    return `missing keys: ${file.addedKeys.join(' ')}`;
  return 'differs';
}

/** What a run will do to a file, for the plan preview. */
export function planStatus(file: FilePlan): string {
  switch (file.action) {
    case 'create':
      return 'create';
    case 'update':
      return keyChanges(file, 'add', 'prune') ?? 'update';
    case 'mode':
      return `fix mode (${modeChange(file)})`;
    case 'unchanged':
      return 'unchanged';
    case 'skip':
      if (file.reason === 'loosens') return `skip (${file.error})`;
      return file.reason === 'exists'
        ? 'skip (exists)'
        : `skip (refused: ${file.error})`;
  }
}

/** One JSON entry per file of an apply run; `mode` when the run changed it. */
export function applyJson(file: FilePlan, result?: ApplyResult) {
  const changed =
    (file.action === 'mode' || file.action === 'update') &&
    file.currentMode !== undefined &&
    file.currentMode !== file.mode;
  return {
    path: file.path,
    policy: file.policy,
    action: file.action,
    status: applyStatus(file, result),
    addedKeys: file.addedKeys,
    prunedKeys: file.prunedKeys ?? [],
    written: result?.written ?? false,
    ...(file.reason ? { reason: file.reason } : {}),
    ...(file.error || result?.error
      ? { error: file.error ?? result?.error }
      : {}),
    ...(changed
      ? {
          mode: {
            from: formatMode(file.currentMode!),
            to: formatMode(file.mode),
          },
        }
      : {}),
  };
}

/** How a problem reads after its file's path, never with a raw secret. */
function problemText(problem: CheckProblem): string {
  const { code, key, keys, line, message, shown } = problem;
  switch (code) {
    case 'invalid-line':
      return `line ${line} ${message}`;
    case 'protected':
      return protectedLine({ key: key!, message });
    case 'mode':
      // apply only removes permissions: a mode it would loosen has no fix.
      return `${message} (${
        problem.fix
          ? 'run configure-env apply to fix it'
          : 'apply never adds a permission; chmod it by hand'
      })`;
    case 'invalid-value':
      return `${key}: ${message}${shown ? ` (got ${shown})` : ''}`;
    default:
      return key ? `${keys?.join(', ') ?? key}: ${message}` : message;
  }
}

/**
 * For check: one line per problem, `path: <problem>`, warnings marked so;
 * `path: ok` for a file without any.
 */
export function checkLines(file: FileCheck): string[] {
  if (!file.problems.length) return [`${file.path}: ok`];
  return file.problems.map(
    (problem) =>
      `${file.path}: ${problem.severity === 'warning' ? 'warning: ' : ''}${problemText(problem)}`,
  );
}

/** For check: a git-ignore problem, with what fixes it. */
export function gitignoreLine(problem: GitignoreProblem): string {
  const entries = problem.entries.join(', ');
  const fix = problem.blocked
    ? `${problem.gitignore} is a symlink; add ${entries} to it yourself`
    : `check --fix adds ${entries} to ${problem.gitignore}`;
  return `${problem.path}: ${problem.message} (${fix})`;
}

/** For check: what a git-ignore fix wrote. */
export const gitignoreFixLine = (fix: GitignoreFix) =>
  fix.created
    ? `Created ${fix.gitignore} with ${fix.added.join(', ')}`
    : `Added ${fix.added.join(', ')} to ${fix.gitignore}`;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * For check: `N errors, M warnings in K files`, K the files (or the state
 * folder) with a problem; `Everything is current.` without any, unless the run itself has
 * errors (an invalid --set value, an unknown --file path).
 */
export function checkSummary(report: CheckReport): string {
  const { errors, warnings } = report.summary;
  if (!errors && !warnings)
    return report.ok
      ? 'Everything is current.'
      : 'No problem in the files, but the run has errors.';
  const files = new Set([
    ...report.files
      .filter((file) => file.problems.length)
      .map((file) => file.path),
    ...report.gitignore.map((problem) => problem.path),
  ]).size;
  return `${count(errors, 'error')}, ${count(warnings, 'warning')} in ${count(files, 'file')}`;
}
