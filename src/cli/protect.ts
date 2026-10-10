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
  mergeState,
  recorded,
  withStateLock,
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

/**
 * The state of a run, as read at its start: it decides early refusals and
 * which replacements to confirm. The checks that count run again against
 * the state re-read under its lock.
 */
export interface RunState {
  path: string;
  state: State;
}

/** A protected key a run replaces. */
export interface Replaced {
  file: string;
  key: string;
}

/** A protected key of a file the run writes: its value before and after. */
export interface ProtectedCheck {
  file: FileSpec;
  key: string;
  current: string | undefined;
  next: string | undefined;
}

/** A file of the run as it is after the run, for recording its values. */
export interface RunFile {
  spec: FileSpec;
  valueOf: (key: string) => string | undefined;
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
  return state && { path: context.statePath, state };
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

/** The checks of a file's protected keys, from `before` to `after` the run. */
export const checksOf = (
  schema: EnvSchema,
  file: FileSpec,
  before: (key: string) => string | undefined,
  after: (key: string) => string | undefined,
): ProtectedCheck[] =>
  fileKeys(schema, file)
    .filter((key) => isProtected(schema, file, key))
    .map((key) => ({ file, key, current: before(key), next: after(key) }));

/** The refusals and replacements of the checks against `state`. */
export function verdictsOf(
  schema: EnvSchema,
  state: State,
  checks: readonly ProtectedCheck[],
  replace: ReadonlySet<string>,
): { refused: ProtectedProblem[]; replaced: Replaced[] } {
  const refused: ProtectedProblem[] = [];
  const replaced: Replaced[] = [];
  for (const { file, key, current, next } of checks) {
    const verdict = protectVerdict(
      schema,
      state,
      file,
      key,
      current,
      next,
      replace,
    );
    if (verdict.action === 'refuse') refused.push(verdict.problem);
    if (verdict.action === 'replace') replaced.push({ file: file.path, key });
  }
  return { refused, replaced };
}

/**
 * The record and remove intents for the protected values the files hold
 * after the run: a replaced one over its old fingerprint (an emptied one is
 * forgotten), any other only where none is recorded, so a value edited by
 * hand is left for check to report.
 */
function intentsOf(
  schema: EnvSchema,
  files: readonly RunFile[],
  replaced: readonly Replaced[],
): StateChange[] {
  const changes: StateChange[] = [];
  for (const { spec, valueOf } of files) {
    for (const key of fileKeys(schema, spec)) {
      if (!isProtected(schema, spec, key)) continue;
      const value = valueOf(key);
      const replace = replaced.some(
        (entry) => entry.file === spec.path && entry.key === key,
      );
      if (value)
        changes.push({
          action: 'record',
          file: spec.path,
          key,
          value,
          replace,
        });
      else if (replace)
        changes.push({ action: 'remove', file: spec.path, key });
    }
  }
  return changes;
}

/** What the write of a guarded run did. */
export interface Written<T> {
  value: T;
  /** The files whose content is now what the run planned. */
  done: readonly string[];
  /** The files it wrote. */
  written: readonly string[];
}

/**
 * Writes a run that may touch protected values. A run that writes or holds
 * none just writes. Any other takes the state's lock before writing
 * anything: under it, it re-reads the state, runs every protected check
 * against it (a refusal exits 2), writes the env files, merges its changes
 * into the state and releases the lock. A lock or state it cannot get exits
 * 1 with nothing written; a state write that fails after the env files is
 * returned as `stateError`.
 */
export async function writeProtected<T>(
  context: Context,
  schema: EnvSchema,
  run: RunState | undefined,
  plan: {
    checks: readonly ProtectedCheck[];
    files: readonly RunFile[];
    replace: ReadonlySet<string>;
    hints?: readonly string[];
  },
  write: () => Promise<Written<T>>,
): Promise<{ value: T; replaced: Replaced[]; stateError?: string[] }> {
  const { checks, files, replace, hints = [] } = plan;
  // A run that writes or holds no protected value never takes the lock.
  const involved =
    checks.some((check) => check.current || check.next) ||
    files.some(({ spec, valueOf }) =>
      fileKeys(schema, spec).some(
        (key) => isProtected(schema, spec, key) && valueOf(key),
      ),
    );
  if (!run || !involved) return { value: (await write()).value, replaced: [] };

  let writing = false;
  try {
    return await withStateLock(run.path, async () => {
      const fresh = await loadState(run.path);
      if (!fresh.ok) throw new Error(fresh.message);
      const { refused, replaced } = verdictsOf(
        schema,
        fresh.state,
        checks,
        replace,
      );
      if (refused.length) throw protectedError(refused, ...hints);
      writing = true;
      const { value, done, written } = await write();
      const changes = intentsOf(
        schema,
        files.filter((file) => done.includes(file.spec.path)),
        replaced,
      );
      try {
        await mergeState(run.path, changes, context.io.writeState);
        return { value, replaced };
      } catch (error) {
        return {
          value,
          replaced,
          stateError: stateFailure(context, run, error, written),
        };
      }
    });
  } catch (error) {
    if (error instanceof CliError || writing) throw error;
    const lines = [
      `${displayPath(context.io.cwd, run.path)}: not written: ${(error as Error).message}`,
      'nothing was written',
    ];
    throw new CliError(1, lines, [
      {
        kind: 'file',
        path: displayPath(context.io.cwd, run.path),
        message: lines.join('; '),
      },
    ]);
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
