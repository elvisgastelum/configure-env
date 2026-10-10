// What every command shares: the global options, the project root and
// schema, and where values come from.

import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';
import type { FilePlan, PlanError, ValueError } from '../engine/plan.ts';
import { fileKeys } from '../engine/plan.ts';
import {
  type EnvSchema,
  type FileSpec,
  isTemplate,
} from '../schema/definition.ts';
import { DEFAULT_SCHEMA_PATH, loadSchema } from '../schema/load.ts';
import { validateValue } from '../schema/values.ts';
import type { Io, Prompts } from './io.ts';
import { clackPrompts } from './prompts.ts';

/**
 * A problem with one key, as `--json` reports it: `value` when a value
 * breaks the variable's rules (exit 1), `usage` when the options misuse the
 * key (exit 2). Never holds a value.
 */
export type KeyProblem =
  ValueError | { kind: 'usage'; key: string; message: string };

/**
 * A failure that ends the command with `code` after printing `lines`.
 * `errors` holds it as key problems, for `--json`.
 */
export class CliError extends Error {
  constructor(
    readonly code: number,
    readonly lines: string[],
    readonly errors?: KeyProblem[],
  ) {
    super(lines[0]);
  }
}

/**
 * A failure about one key, never holding its value: a `usage` one exits 2,
 * a `value` one 1. `hints` follow the message.
 */
export const keyError = (
  kind: KeyProblem['kind'],
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
  file: { type: 'string', multiple: true },
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
  file?: string[];
  ci?: boolean;
  json?: boolean;
  'no-color'?: boolean;
};

export interface Context {
  io: Io;
  prompts: Prompts;
  /** The absolute project root. */
  root: string;
  /** The absolute schema path. */
  schemaPath: string;
  /** The --file paths; every file when absent. */
  files?: string[];
  /** Unattended: --ci, or CI set in the environment. */
  ci: boolean;
  json: boolean;
}

/** A path for messages: relative to `cwd` when inside it, else absolute. */
export function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return !rel || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

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
  for (const path of context.files ?? []) {
    if (!result.schema.files.some((file) => file.path === path))
      throw usageError(`${path}: is not in the schema`);
  }
  return result.schema;
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
 * new file, the missing keys of a merge file, none for a skipped one or a
 * template. A key the file sets literally (`values`) takes none.
 */
export function neededKeysOf(schema: EnvSchema, plan: FilePlan): string[] {
  if (plan.action === 'skip') return [];
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
 * them is an error, unless it is `deferred`: it is written empty.
 */
export function resolveValues(
  schema: EnvSchema,
  keys: readonly string[],
  given: Readonly<Record<string, string>>,
  env: Io['env'],
  deferred: readonly string[] = [],
): { values: Record<string, string>; errors: PlanError[] } {
  const values: Record<string, string> = { ...given };
  const errors: PlanError[] = [];
  for (const key of keys) {
    const value = givenValue(key, given, env);
    if (value !== undefined) {
      values[key] = value;
      continue;
    }
    const spec = schema.variables[key]!;
    if (spec.default !== undefined || deferred.includes(key)) continue;
    const result = validateValue(spec, undefined);
    if (!result.ok) errors.push({ kind: 'value', key, message: result.error });
  }
  return { values, errors };
}

/** A plan error as one line. */
export const describeError = (error: PlanError) =>
  `${error.kind === 'file' ? error.path : error.key}: ${error.message}`;
