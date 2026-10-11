// How plans, results and drift read, as plain lines and as JSON.

import type { ApplyResult } from '../engine/apply.ts';
import type { FileDrift } from '../engine/check.ts';
import { type FilePlan, formatMode, loosens } from '../engine/plan.ts';
import { ruleKeys } from '../schema/values.ts';
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

/** A mode drift, with how to fix it: apply only removes permissions. */
function modeLine({ actual, expected }: NonNullable<FileDrift['mode']>) {
  const hint = loosens(Number.parseInt(actual, 8), Number.parseInt(expected, 8))
    ? 'apply never adds a permission; chmod it by hand'
    : 'run configure-env apply to fix it';
  return `mode ${actual}, expected ${expected} (${hint})`;
}

const DRIFT_STATUS: Record<FileDrift['status'], (file: FileDrift) => string> = {
  current: () => 'current',
  missing: () => 'missing',
  differs: () => 'differs from the schema',
  'missing-keys': (file) => `missing keys: ${file.missingKeys.join(' ')}`,
  refused: (file) => `refused (${file.error})`,
};

/**
 * For check: the file's state, its unknown keys, its mode, then its invalid values, broken
 * rules, lines and protected values that no longer match.
 */
export function driftLines(file: FileDrift): string[] {
  return [
    `${file.path}: ${DRIFT_STATUS[file.status](file)}`,
    ...(file.unknownKeys.length
      ? [
          `${file.path}: unknown keys: ${file.unknownKeys.join(', ')} (run configure-env apply --prune to remove them)`,
        ]
      : []),
    ...(file.mode ? [`${file.path}: ${modeLine(file.mode)}`] : []),
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
    ...file.protected.map(
      (mismatch) => `${file.path}: ${protectedLine(mismatch)}`,
    ),
  ];
}
