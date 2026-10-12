// Protected variables (set, unset, apply): once a non-template file holds a
// value, it never changes without a replacement asked for by key, and a
// value recorded in the state is never silently replaced after the file lost
// it. The state holds only salted HMACs of the values.

import { displayPath } from '../engine/paths.ts';
import { fileKeys } from '../engine/plan.ts';
import {
  type State,
  type StateChange,
  type StateWriter,
  matchesFingerprint,
  mergeState,
  recorded,
  recordedDay,
  StateBusyError,
  withStateTransaction,
} from '../engine/state.ts';
import {
  type EnvSchema,
  type FileSpec,
  isTemplate,
  protectedReason,
} from '../schema/definition.ts';

/** A refused change to a protected value; never holds a value. */
export interface ProtectedProblem {
  kind: 'protected';
  key: string;
  message: string;
  /** The schema's reason, when it gives one. */
  reason?: string;
}

/**
 * What a write may do to a protected key: write it (`allow`), leave it
 * (`unchanged`), replace it as asked, or nothing at all.
 */
export type Verdict =
  | { action: 'allow' | 'unchanged' | 'replace' }
  | { action: 'refuse'; problem: ProtectedProblem };

/**
 * The state of a run, as read at its start: it decides early refusals and
 * which replacements to confirm. The checks that count run again against
 * the state re-read in its write transaction.
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

/** How a run reaches the state: paths in messages are relative to `cwd`. */
export interface StateAccess {
  cwd: string;
  /** Writes the state; tests pass one that fails. */
  writeState?: StateWriter;
}

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

/** Whether the schema protects any variable. */
export const protectsAny = (schema: EnvSchema) =>
  Object.values(schema.variables).some((spec) => spec.protected !== undefined);

/**
 * The warning of a state a best-effort run could not use. `known`: the run
 * knows pruned keys had fingerprints; a state it could not read cannot tell.
 */
export const keptWarning = (
  cwd: string,
  path: string,
  verb: string,
  message: string,
  known = true,
) => {
  const shown = displayPath(cwd, path);
  const reason = message.startsWith(`${path}: `)
    ? message.slice(path.length + 2)
    : message;
  const kept = known
    ? 'fingerprints of pruned keys were kept'
    : 'fingerprints of pruned keys, if any, were kept';
  return `${shown}: ${verb} (${reason}); ${kept}`;
};

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

/** A key a run removed from a file without a schema variable to check it. */
export interface Forgotten {
  file: string;
  key: string;
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
 * The outcome of a guarded write: written (a state write that failed after
 * the env files is `stateError`, a best-effort one `warning`), refused by a
 * protected check in the state's transaction, or stopped by a state it could
 * not get, with nothing written (`path` as shown, `lines` the reason).
 */
export type Guarded<T> =
  | {
      ok: true;
      value: T;
      replaced: Replaced[];
      stateError?: string[];
      warning?: string;
    }
  | { ok: false; kind: 'protected'; problems: ProtectedProblem[] }
  | { ok: false; kind: 'state'; path: string; lines: string[] };

/**
 * Writes a run that may touch protected values. A run that writes or holds
 * none just writes. Any other takes the state's write transaction before writing
 * anything: under it, it re-reads the state, runs every protected check
 * against it (a refusal writes nothing), writes the env files, merges its
 * changes into the state and commits. The fingerprints of the
 * `forget` keys (pruned ones) of the files written as planned are removed.
 * With `bestEffort` (the schema protects nothing), a run that only forgets
 * writes even when it cannot use the state, returning a `warning` instead of
 * failing. An error `write` throws is thrown.
 */
export async function writeProtected<T>(
  access: StateAccess,
  schema: EnvSchema,
  run: RunState | undefined,
  plan: {
    checks: readonly ProtectedCheck[];
    files: readonly RunFile[];
    replace: ReadonlySet<string>;
    forget?: readonly Forgotten[];
    bestEffort?: boolean;
  },
  write: () => Promise<Written<T>>,
): Promise<Guarded<T>> {
  const { checks, files, replace } = plan;
  const forget = (plan.forget ?? []).filter(
    (entry) => run && recorded(run.state, entry.file, entry.key),
  );
  const guarded =
    checks.some((check) => check.current || check.next) ||
    files.some(({ spec, valueOf }) =>
      fileKeys(schema, spec).some(
        (key) => isProtected(schema, spec, key) && valueOf(key),
      ),
    );
  // A run that writes or holds no protected value never opens the state.
  if (!run || (!guarded && !forget.length))
    return { ok: true, value: (await write()).value, replaced: [] };
  const lenient = Boolean(plan.bestEffort) && !guarded;
  const kept = (verb: string, error: unknown) =>
    keptWarning(access.cwd, run.path, verb, (error as Error).message);

  let writing = false;
  try {
    return await withStateTransaction(
      run.path,
      async (tx): Promise<Guarded<T>> => {
        const { refused, replaced } = verdictsOf(
          schema,
          tx.state,
          checks,
          replace,
        );
        if (refused.length)
          return { ok: false, kind: 'protected', problems: refused };
        writing = true;
        const { value, done, written } = await write();
        const changes: StateChange[] = [
          ...intentsOf(
            schema,
            files.filter((file) => done.includes(file.spec.path)),
            replaced,
          ),
          ...forget
            .filter((entry) => done.includes(entry.file))
            .map((entry) => ({ action: 'remove' as const, ...entry })),
        ];
        try {
          await mergeState(tx, changes, access.writeState);
          return { ok: true, value, replaced };
        } catch (error) {
          if (lenient)
            return {
              ok: true,
              value,
              replaced,
              warning: kept('not written', error),
            };
          return {
            ok: true,
            value,
            replaced,
            stateError: stateFailure(access.cwd, run, error, written),
          };
        }
      },
    );
  } catch (error) {
    if (writing) throw error;
    if (lenient)
      return {
        ok: true,
        value: (await write()).value,
        replaced: [],
        warning: kept(
          error instanceof StateBusyError ? 'not written' : 'cannot be read',
          error,
        ),
      };
    return {
      ok: false,
      kind: 'state',
      path: displayPath(access.cwd, run.path),
      lines: [
        `${displayPath(access.cwd, run.path)}: not written: ${reasonOf(run.path, error)}`,
        'nothing was written',
      ],
    };
  }
}

/** An error's message without the state path it may start with. */
const reasonOf = (path: string, error: unknown) => {
  const message = (error as Error).message;
  return message.startsWith(`${path}: `)
    ? message.slice(path.length + 2)
    : message;
};

/** The lines of a failed state write. */
export const stateFailure = (
  cwd: string,
  run: RunState,
  error: unknown,
  written: readonly string[],
) => [
  `${displayPath(cwd, run.path)}: not written: ${reasonOf(run.path, error)}`,
  written.length > 1
    ? `${written.join(', ')} were written; their protected values are not recorded`
    : written.length
      ? `${written[0]} was written; its protected values are not recorded`
      : 'no env file was written; the protected values found are not recorded',
];
