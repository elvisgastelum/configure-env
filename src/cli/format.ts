// How plans, results and drift read, as plain lines and as JSON.

import type { ApplyResult } from '../engine/apply.ts';
import { type FileDrift, formatMode } from '../engine/check.ts';
import type { FilePlan } from '../engine/plan.ts';
import { ruleKeys } from '../schema/values.ts';

/** What a run did to a file: `created`, `added keys: A B`, ... */
export function applyStatus(file: FilePlan, result?: ApplyResult): string {
  if (result && !result.ok) return `failed (${result.error})`;
  switch (file.action) {
    case 'create':
      return 'created';
    case 'update':
      return file.policy === 'merge' && file.addedKeys.length
        ? `added keys: ${file.addedKeys.join(' ')}`
        : 'updated';
    case 'unchanged':
      return 'unchanged';
    case 'skip':
      return file.reason === 'exists'
        ? 'skipped (exists)'
        : `skipped (refused: ${file.error})`;
  }
}

/** A file's state before a run, for the file picker. */
export function fileState(file: FilePlan): string {
  if (file.reason === 'refused') return `refused: ${file.error}`;
  if (file.reason === 'exists') return 'exists, never overwritten';
  if (file.previous === undefined) return 'missing';
  if (
    file.currentMode !== undefined &&
    file.modeFixed &&
    file.currentMode !== file.mode
  )
    return `mode ${formatMode(file.currentMode)}, expected ${formatMode(file.mode)}`;
  if (file.action === 'unchanged') return 'current';
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
      return file.policy === 'merge' && file.addedKeys.length
        ? `add keys: ${file.addedKeys.join(' ')}`
        : 'update';
    case 'unchanged':
      return 'unchanged';
    case 'skip':
      return file.reason === 'exists'
        ? 'skip (exists)'
        : `skip (refused: ${file.error})`;
  }
}

/** One JSON entry per file of an apply run. */
export function applyJson(file: FilePlan, result?: ApplyResult) {
  return {
    path: file.path,
    policy: file.policy,
    action: file.action,
    status: applyStatus(file, result),
    addedKeys: file.addedKeys,
    written: result?.written ?? false,
    ...(file.reason ? { reason: file.reason } : {}),
    ...(file.error || result?.error
      ? { error: file.error ?? result?.error }
      : {}),
  };
}

const DRIFT_STATUS: Record<FileDrift['status'], (file: FileDrift) => string> = {
  current: () => 'current',
  missing: () => 'missing',
  differs: () => 'differs from the schema',
  'missing-keys': (file) => `missing keys: ${file.missingKeys.join(' ')}`,
  refused: (file) => `refused (${file.error})`,
};

/** For check: the file's state, its mode, then its invalid values, broken rules and lines. */
export function driftLines(file: FileDrift): string[] {
  return [
    `${file.path}: ${DRIFT_STATUS[file.status](file)}`,
    ...(file.mode
      ? [
          `${file.path}: mode ${file.mode.actual}, expected ${file.mode.expected}`,
        ]
      : []),
    ...file.invalid.map(
      ({ key, shown, message }) =>
        `${file.path}: invalid ${key}=${shown} (${message})`,
    ),
    ...file.rules.map(
      (problem) =>
        `${file.path}: ${ruleKeys(problem).join(', ')}: ${problem.message}`,
    ),
    ...file.invalidLines.map(
      (line) => `${file.path}: line ${line} is not a valid entry`,
    ),
  ];
}
