// Protected variables (set, unset, apply): once a non-template file holds a
// value, it never changes without --replace-protected, and a value recorded
// in the state is never silently replaced after the file lost it. The state
// holds only salted HMACs of the values.

import { fileKeys } from '../engine/plan.ts';
import {
  type State,
  type StateChange,
  loadState,
  matchesFingerprint,
  recorded,
  updateState,
} from '../engine/state.ts';
import {
  type EnvSchema,
  type FileSpec,
  isTemplate,
  protectedReason,
} from '../schema/definition.ts';
import {
  CliError,
  type Context,
  displayPath,
  keyError,
  usageError,
} from './common.ts';

/** A refused change to a protected value; never holds a value. Exit 2. */
export interface ProtectedProblem {
  kind: 'protected';
  key: string;
  message: string;
  /** The schema's reason, when it gives one. */
  reason?: string;
}

/**
 * What a write may do to a protected key: write it (`allow`), leave it
 * (`unchanged`), replace it as --replace-protected asked, or nothing at all.
 */
export type Verdict =
  | { action: 'allow' | 'unchanged' | 'replace' }
  | { action: 'refuse'; problem: ProtectedProblem };

/** The state of a run: loaded once, written once after the env files. */
export interface RunState {
  path: string;
  state: State;
  /**
   * The run's record and remove intents, applied to the state on disk when
   * it is written, so a parallel run's entries survive.
   */
  changes: StateChange[];
}

/** The date a fingerprint was recorded, as YYYY-MM-DD. */
export const recordedDay = (recordedAt: string) => recordedAt.slice(0, 10);

/**
 * A protected problem as one line: `KEY: is protected (...)`, or the
 * sentence forms `KEY was set on DATE; ...` and `KEY no longer matches ...`.
 */
export const protectedLine = ({
  key,
  message,
}: {
  key: string;
  message: string;
}) => (message.startsWith('is ') ? `${key}: ${message}` : `${key} ${message}`);

const problemOf = (
  schema: EnvSchema,
  key: string,
  message: string,
): ProtectedProblem => {
  const reason = protectedReason(schema.variables[key]!);
  return { kind: 'protected', key, message, ...(reason ? { reason } : {}) };
};

/** Whether the schema protects `key` in `file`: never in a template. */
export const isProtected = (schema: EnvSchema, file: FileSpec, key: string) =>
  !isTemplate(file) &&
  Object.hasOwn(schema.variables, key) &&
  schema.variables[key]!.protected !== undefined;

/**
 * Reads the state when the schema protects a variable; undefined when it
 * protects none. A state that cannot be read exits 1 with `hints`.
 */
export async function readState(
  context: Context,
  schema: EnvSchema,
  ...hints: string[]
): Promise<State | undefined> {
  const any = Object.values(schema.variables).some(
    (spec) => spec.protected !== undefined,
  );
  if (!any) return undefined;
  const result = await loadState(context.statePath);
  if (!result.ok)
    throw new CliError(1, [`invalid state ${result.message}`, ...hints]);
  return result.state;
}

/** The state of a write command; one that cannot be read writes nothing. */
export async function loadRunState(
  context: Context,
  schema: EnvSchema,
): Promise<RunState | undefined> {
  const state = await readState(
    context,
    schema,
    'fix or restore it; nothing was written',
  );
  return state && { path: context.statePath, state, changes: [] };
}

/** The keys of the repeated --replace-protected option, each once and checked. */
export function replaceKeys(
  schema: EnvSchema,
  keys: readonly string[] = [],
): Set<string> {
  const unique = new Set(keys);
  for (const key of unique) {
    if (!Object.hasOwn(schema.variables, key))
      throw keyError('usage', key, 'is not declared in the schema');
    if (schema.variables[key]!.protected === undefined)
      throw keyError(
        'usage',
        key,
        '--replace-protected takes a protected variable',
      );
  }
  return unique;
}

/**
 * Whether `key` in `file` may go from `current` (what the file holds;
 * undefined when absent) to `next` (undefined to remove it). A non-empty
 * value never changes without `replace`. A missing or empty one takes only
 * the value recorded for it, or an empty one, unless replaced.
 */
export function protectVerdict(
  schema: EnvSchema,
  state: State | undefined,
  file: FileSpec,
  key: string,
  current: string | undefined,
  next: string | undefined,
  replace: ReadonlySet<string>,
): Verdict {
  if (!isProtected(schema, file, key)) return { action: 'allow' };
  if (next === current) return { action: 'unchanged' };
  let message: string;
  if (current) {
    const reason = protectedReason(schema.variables[key]!);
    message = `is protected${reason ? ` (${reason})` : ''}; pass --replace-protected ${key} to change it`;
  } else {
    const entry = state && recorded(state, file.path, key);
    if (!next || !entry || matchesFingerprint(state, file.path, key, next))
      return { action: 'allow' };
    message = `was set on ${recordedDay(entry.recordedAt)}; restore it from your backup, or pass --replace-protected ${key}`;
  }
  return replace.has(key)
    ? { action: 'replace' }
    : { action: 'refuse', problem: problemOf(schema, key, message) };
}

/** The refusals as a failure: exit 2, writing nothing. */
export const protectedError = (
  problems: readonly ProtectedProblem[],
  ...hints: string[]
) => new CliError(2, [...problems.map(protectedLine), ...hints], [...problems]);

/**
 * Asks a person to type each replaced key's name. Unattended (--ci or
 * --json) the flag alone is enough; with no terminal it exits 2. False on
 * a cancel; a wrong name exits 2.
 */
export async function confirmReplacements(
  { io, prompts, ci, json }: Context,
  keys: readonly string[],
): Promise<boolean> {
  if (!keys.length || ci || json) return true;
  if (!io.isTTY)
    throw usageError(
      '--replace-protected needs a terminal to confirm; pass --ci to replace without one',
    );
  for (const key of keys) {
    const answer = await prompts.text({
      message: `Type ${key} to replace its protected value`,
    });
    if (prompts.isCancel(answer)) return false;
    if (answer !== key)
      throw keyError(
        'usage',
        key,
        'the confirmation did not match; nothing was written',
      );
  }
  return true;
}

/**
 * Records the protected values `file` holds after a run: a replaced one over
 * its old fingerprint (an emptied one is forgotten), any other only when
 * none is recorded, so a value edited by hand is left for check to report.
 */
export function recordValues(
  run: RunState | undefined,
  schema: EnvSchema,
  file: FileSpec,
  valueOf: (key: string) => string | undefined,
  replaced: ReadonlySet<string> = new Set(),
) {
  if (!run) return;
  for (const key of fileKeys(schema, file)) {
    if (!isProtected(schema, file, key)) continue;
    const value = valueOf(key);
    const replace = replaced.has(key);
    if (!value && !replace) continue;
    const change: StateChange = value
      ? { action: 'record', file: file.path, key, value, replace }
      : { action: 'remove', file: file.path, key };
    // Decided against the state on disk when it is written, under its lock:
    // a parallel run may have changed it since this one read it.
    run.changes.push(change);
  }
}

/**
 * Writes the run's changes to the state, after the env files, merged into
 * the state on disk under its lock. A failure exits 1, saying what was
 * written: those files hold values it does not know.
 */
export async function saveRunState(
  context: Context,
  run: RunState | undefined,
  written: readonly string[],
) {
  if (!run?.changes.length) return;
  try {
    await updateState(run.path, run.changes);
  } catch (error) {
    throw new CliError(1, stateFailure(context, run, error, written));
  }
}

/** The lines of a failed state write. */
export const stateFailure = (
  { io }: Context,
  run: RunState,
  error: unknown,
  written: readonly string[],
) => [
  `${displayPath(io.cwd, run.path)}: not written: ${(error as Error).message}`,
  written.length > 1
    ? `${written.join(', ')} were written; their protected values are not recorded`
    : written.length
      ? `${written[0]} was written; its protected values are not recorded`
      : 'no env file was written; the protected values found are not recorded',
];
