// Protected variables (set, unset, apply) as the CLI drives them: reading
// the state, the repeated --replace-protected option, confirming each
// replacement, and the exit codes of a refusal. The checks themselves, and
// the guarded write, are @configure-env/core's.

import {
  type EnvSchema,
  type Guarded,
  type ProtectedProblem,
  type RunState,
  type State,
  type Written,
  keptWarning,
  loadState,
  protectedLine,
  protectsAny,
  writeProtected as writeGuarded,
} from '@configure-env/core';
import { CliError, type Context, keyError, usageError } from './common.ts';

export {
  type Forgotten,
  type ProtectedCheck,
  type ProtectedProblem,
  type Replaced,
  type RunFile,
  type RunState,
  type Verdict,
  type Written,
  checksOf,
  isProtected,
  protectVerdict,
  protectedLine,
  protectsAny,
  verdictsOf,
} from '@configure-env/core';

/** Reads the state; one that cannot be read exits 1 with `hints`. */
async function readStateFile(context: Context, hints: readonly string[]) {
  const result = await loadState(context.statePath);
  if (!result.ok)
    throw new CliError(1, [`invalid state ${result.message}`, ...hints]);
  return result.state;
}

/**
 * Reads the state when the schema protects a variable; undefined when it
 * protects none. A state that cannot be read exits 1 with `hints`.
 */
export async function readState(
  context: Context,
  schema: EnvSchema,
  ...hints: string[]
): Promise<State | undefined> {
  return protectsAny(schema) ? readStateFile(context, hints) : undefined;
}

/** The state of a write command; one that cannot be read writes nothing. */
export async function loadRunState(
  context: Context,
  schema: EnvSchema,
): Promise<RunState | undefined> {
  if (!protectsAny(schema)) return undefined;
  const state = await readStateFile(context, [
    'fix or restore it; nothing was written',
  ]);
  return { path: context.statePath, state };
}

/**
 * The state of a run that reads it only to forget the fingerprints of pruned
 * keys, when the schema protects nothing: a state that cannot be read is a
 * warning, for a run that prunes a key, and the run goes on without it.
 */
export async function loadForgetState(
  context: Context,
): Promise<{ run?: RunState; warning?: string }> {
  const result = await loadState(context.statePath);
  if (!result.ok)
    return {
      warning: keptWarning(
        context.io.cwd,
        context.statePath,
        'cannot be read',
        result.message,
        false,
      ),
    };
  return { run: { path: context.statePath, state: result.state } };
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

/** The refusals as a failure: exit 2, writing nothing. */
export const protectedError = (
  problems: readonly ProtectedProblem[],
  ...hints: string[]
) => new CliError(2, [...problems.map(protectedLine), ...hints], [...problems]);

/**
 * A state a guarded write could not get or use, so nothing was written:
 * exit 1, with a `file` error for --json.
 */
export const stateError = (path: string, lines: string[]) =>
  new CliError(1, lines, [{ kind: 'file', path, message: lines.join('; ') }]);

/**
 * Asks a person to type each replaced key's name. Unattended (--ci or
 * --json) the flag alone is enough; with no terminal it exits 2. False on
 * a cancel; a wrong name exits 2.
 */
export async function confirmReplacements(
  { io, prompts, ci, json }: Pick<Context, 'io' | 'prompts' | 'ci' | 'json'>,
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
 * The core's guarded write with the CLI's exits: a refusal in the state's transaction
 * exits 2 with `hints`, a state it cannot get or use exits 1 with nothing
 * written.
 */
export async function writeProtected<T>(
  context: Context,
  schema: EnvSchema,
  run: RunState | undefined,
  plan: Parameters<typeof writeGuarded>[3] & { hints?: readonly string[] },
  write: () => Promise<Written<T>>,
): Promise<Extract<Guarded<T>, { ok: true }>> {
  const result = await writeGuarded(
    { cwd: context.io.cwd, writeState: context.io.writeState },
    schema,
    run,
    plan,
    write,
  );
  if (result.ok) return result;
  if (result.kind === 'protected')
    throw protectedError(result.problems, ...(plan.hints ?? []));
  throw stateError(result.path, result.lines);
}
