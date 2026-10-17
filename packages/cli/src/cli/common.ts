// What every command shares: the global options, the project root and
// schema, and where values come from.

import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';
import {
  DEFAULT_SCHEMA_PATH,
  DEFAULT_STATE_PATH,
  displayPath,
  type EnvSchema,
  type FilePlan,
  type FileSpec,
  type PlanError,
  type ValueError,
  fileKeys,
  fileRules,
  isInside,
  isTemplate,
  loadSchema,
  parseDotenv,
  recordHistory,
  ruleKeys,
  validateValue,
} from '@configure-env/core';
import type { Io, Prompts } from './io.ts';
import { type ProtectedProblem, protectedLine } from './protect.ts';
import { clackPrompts } from './prompts.ts';

/**
 * A problem with one key, as `--json` reports it: `value` when a value
 * breaks the variable's rules (exit 1), `usage` when the options misuse the
 * key (exit 2), `protected` when a run would change a protected value
 * (exit 2, with the schema's `reason`). Never holds a value. apply's failure
 * document carries these and the `PlanError` kinds alike, so `file` (an
 * unsafe path, exit 1) reaches it too.
 */
export type KeyProblem =
  | ValueError
  | { kind: 'usage'; key: string; message: string }
  | ProtectedProblem;

/**
 * A failure that ends the command with `code` after printing `lines`.
 * `errors` holds it as key problems, for `--json`.
 */
export class CliError extends Error {
  constructor(
    readonly code: number,
    readonly lines: string[],
    readonly errors?: (KeyProblem | PlanError)[],
  ) {
    super(lines[0]);
  }
}

/**
 * A failure about one key, never holding its value: a `usage` one exits 2,
 * a `value` one 1. `hints` follow the message.
 */
export const keyError = (
  kind: 'value' | 'usage',
  key: string,
  message: string,
  ...hints: string[]
) =>
  new CliError(
    kind === 'usage' ? 2 : 1,
    [`${key}: ${message}`, ...hints],
    [{ kind, key, message }],
  );

export const NO_TERMINAL =
  'no terminal for the interactive mode; pass --ci (or set CI=true) to run unattended';

/** A usage error: exit code 2. */
export const usageError = (...lines: string[]) => new CliError(2, lines);

/** The usage error for a key that `option` takes but that is given another way too. */
export const givenTwice = (option: string, key: string) =>
  keyError('usage', key, `${option} takes a key given no other way`);

export const GLOBAL_OPTIONS = {
  schema: { type: 'string' },
  root: { type: 'string' },
  state: { type: 'string' },
  file: { type: 'string', multiple: true },
  env: { type: 'string' },
  ci: { type: 'boolean' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const satisfies ParseArgsOptionsConfig;

/** Parses a command's arguments: the global options plus its own. */
export function parseCommand<T extends ParseArgsOptionsConfig>(
  args: string[],
  options: T,
) {
  try {
    return parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...options },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw usageError((error as Error).message);
  }
}

/** Like {@link parseCommand}, also returning the positional arguments. */
export function parseCommandArgs<T extends ParseArgsOptionsConfig>(
  args: string[],
  options: T,
) {
  try {
    return parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...options },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw usageError((error as Error).message);
  }
}

type GlobalValues = {
  schema?: string;
  root?: string;
  state?: string;
  file?: string[];
  env?: string;
  ci?: boolean;
  json?: boolean;
  'no-color'?: boolean;
};

/** The environment the variable that names one picks when --env is absent. */
export const ENV_VARIABLE = 'CONFIGURE_ENV_ENV';

/** The environment a run targets: --env, else CONFIGURE_ENV_ENV, else local. */
export const selectedEnvironment = (
  io: Io,
  values: { env?: string | undefined },
): string => values.env || io.env[ENV_VARIABLE] || 'local';

export interface Context {
  io: Io;
  prompts: Prompts;
  /** The absolute project root. */
  root: string;
  /** The absolute schema path. */
  schemaPath: string;
  /** The absolute path of the protected variables' state. */
  statePath: string;
  /** The --file paths; every file when absent. */
  files?: string[];
  /** Unattended: --ci, or CI set in the environment. */
  ci: boolean;
  json: boolean;
}

export { displayPath } from '@configure-env/core';

/**
 * Records a run's changes in the history of edits, as the CLI's; a history
 * it cannot write is a warning on stderr, never a failure: the files were
 * written.
 */
export async function recordRun(
  context: Context,
  changes: Parameters<typeof recordHistory>[2],
): Promise<string[]> {
  const { warnings } = await recordHistory(context.statePath, 'cli', changes);
  const shown = displayPath(context.io.cwd, context.statePath);
  return warnings.map((line) => line.replaceAll(context.statePath, shown));
}

/** Prints warnings on stderr, as every command does. */
export const printWarnings = (io: Io, warnings: readonly string[]) =>
  warnings.forEach((line) => io.stderr(`configure-env: warning: ${line}`));

/** Whether CI is set to anything but empty, `false` or `0`. */
export const isCiEnv = (env: Io['env']) =>
  Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0';

const isDirectory = (path: string) =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

/** Resolves the global options into a context. */
export async function contextOf(
  io: Io,
  values: GlobalValues,
): Promise<Context> {
  // NO_COLOR is what @clack/prompts (node:util styleText) honours.
  if (values['no-color']) io.env.NO_COLOR = '1';
  // A command that works on this project only must never pass for one that
  // ran against the environment asked for.
  const environment = selectedEnvironment(io, values);
  if (environment !== 'local')
    throw usageError(
      `${values.env ? '--env' : ENV_VARIABLE} ${environment}: this command runs on the local project only; only check and init run against an environment yet`,
      values.env
        ? 'drop --env to run it here'
        : `unset ${ENV_VARIABLE} to run it here`,
    );
  const root = resolve(io.cwd, values.root ?? '.');
  if (!(await isDirectory(root)))
    throw usageError(`no such directory: ${root}`);
  return {
    io,
    prompts: io.prompts ?? clackPrompts,
    root,
    schemaPath: values.schema
      ? resolve(io.cwd, values.schema)
      : join(root, DEFAULT_SCHEMA_PATH),
    statePath: resolve(root, values.state ?? DEFAULT_STATE_PATH),
    ...(values.file?.length ? { files: values.file } : {}),
    ci: Boolean(values.ci) || isCiEnv(io.env),
    json: Boolean(values.json),
  };
}

/**
 * Reads and validates the schema: a missing one is a usage error (with the
 * init hint), an invalid one exit code 1. Checks the --file paths too.
 */
export async function loadContextSchema(context: Context): Promise<EnvSchema> {
  const { schemaPath } = context;
  const found = await stat(schemaPath).then(
    () => true,
    () => false,
  );
  if (!found)
    throw usageError(
      `no schema at ${schemaPath}`,
      'run configure-env init to create one, or pass --schema <path>',
    );
  const result = await loadSchema(schemaPath);
  if (!result.ok)
    throw new CliError(1, [
      `invalid schema ${schemaPath}:`,
      ...result.errors.map((error) => `  ${error.path}: ${error.message}`),
    ]);
  checkSchemaFiles(result.schema, context.files);
  // The state must never land in an env file, or in a template's place.
  for (const file of result.schema.files) {
    if (isInside(resolve(context.root, file.path), context.statePath))
      throw usageError(
        `--state must not be a schema file or inside one: ${file.path}`,
      );
  }
  return result.schema;
}

/** The --file paths must be the schema's: one that is not exits 2. */
export function checkSchemaFiles(
  schema: EnvSchema,
  files: readonly string[] | undefined,
): void {
  for (const path of files ?? []) {
    if (!schema.files.some((file) => file.path === path))
      throw usageError(`${path}: is not in the schema`);
  }
}

/** `--set KEY=VALUE` pairs as a record; a pair without `=` is a usage error. */
export function parseSets(pairs: readonly string[] = []) {
  const sets: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw usageError(`--set takes KEY=VALUE, got ${pair}`);
    sets[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return sets;
}

/**
 * The variables a file's run takes values for: every one for a generate or
 * new file, the missing keys of a merge file, none for a skipped one, a
 * chmod or a template. A key the file sets literally (`values`) takes none.
 */
export function neededKeysOf(schema: EnvSchema, plan: FilePlan): string[] {
  if (plan.action === 'skip' || plan.action === 'mode') return [];
  const spec = schema.files.find((file) => file.path === plan.path)!;
  const keys =
    plan.policy === 'generate' || plan.action === 'create'
      ? fileKeys(schema, spec)
      : plan.addedKeys;
  return keys.filter((key) => takesValue(schema, spec, key));
}

/**
 * Whether a given value (--set, --generate, env) for `key` reaches `file`:
 * one of its variables, not set literally by its `values`, not a template.
 */
export const takesValue = (schema: EnvSchema, file: FileSpec, key: string) =>
  !isTemplate(file) &&
  file.values?.[key] === undefined &&
  fileKeys(schema, file).includes(key);

/** The keys any of the planned files takes values for, in schema order. */
export function neededKeys(
  schema: EnvSchema,
  plans: readonly FilePlan[],
): string[] {
  const needed = new Set(plans.flatMap((plan) => neededKeysOf(schema, plan)));
  return Object.keys(schema.variables).filter((key) => needed.has(key));
}

/** A value from --set, else the non-empty environment variable. */
export const givenValue = (
  key: string,
  sets: Readonly<Record<string, string>>,
  env: Io['env'],
): string | undefined => sets[key] ?? (env[key] || undefined);

/**
 * The values to plan with: every `given` value (the --set pairs and the
 * --generate values), then each needed key's environment variable; the
 * planner falls back to the default. A needed required key with none of
 * them is an error, unless it is `deferred`: it is written empty, and
 * listed in `empty`.
 */
export function resolveValues(
  schema: EnvSchema,
  keys: readonly string[],
  given: Readonly<Record<string, string>>,
  env: Io['env'],
  deferred: readonly string[] = [],
): { values: Record<string, string>; errors: PlanError[]; empty: string[] } {
  const values: Record<string, string> = { ...given };
  const errors: PlanError[] = [];
  const empty: string[] = [];
  for (const key of keys) {
    const value = givenValue(key, given, env);
    if (value !== undefined) {
      values[key] = value;
      continue;
    }
    const spec = schema.variables[key]!;
    if (spec.default !== undefined) continue;
    if (deferred.includes(key)) {
      empty.push(key);
      continue;
    }
    const result = validateValue(spec, undefined);
    if (!result.ok) errors.push({ kind: 'value', key, message: result.error });
  }
  return { values, errors, empty };
}

/**
 * The rules between variables that the files a run writes would break, as
 * value errors: each file's resulting values over its own keys, for the rules
 * that name a key the run writes to it. A `requiredUnless` of a `deferred` key
 * is left for a person, as a deferred required key is.
 */
export function ruleErrors(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  deferred: readonly string[] = [],
): ValueError[] {
  const errors = new Map<string, ValueError>();
  for (const plan of plans) {
    if (plan.content === undefined) continue;
    if (plan.action !== 'create' && plan.action !== 'update') continue;
    const spec = schema.files.find((file) => file.path === plan.path)!;
    const written = neededKeysOf(schema, plan);
    for (const problem of fileRules(schema, spec, parseDotenv(plan.content))) {
      if (problem.rule === 'requiredUnless' && deferred.includes(problem.key))
        continue;
      if (
        ![problem.key, ...problem.others].some((key) => written.includes(key))
      )
        continue;
      const keys = ruleKeys(problem);
      const error: ValueError = {
        kind: 'value',
        key: problem.key,
        ...(keys.length > 1 ? { keys } : {}),
        message: problem.message,
      };
      errors.set(describeError(error), error);
    }
  }
  return [...errors.values()];
}

/** A plan error or key problem as one line. */
export const describeError = (error: PlanError | KeyProblem) =>
  error.kind === 'protected'
    ? protectedLine(error)
    : `${error.kind === 'file' ? error.path : (error.kind === 'value' && error.keys?.join(', ')) || error.key}: ${error.message}`;
