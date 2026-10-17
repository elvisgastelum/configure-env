// The checks `configure-env apply` makes of a run, which POST /api/plan and
// POST /api/apply make when they take `generate` or `defer` (see
// contracts.ts): the keys those name, a value for each key to generate (the
// one a file of the run holds, else a random one), the required values
// nothing gives, the rules between variables the written files break, and
// the deferred keys each file is left without. The messages are the CLI's,
// which prints them as they come. The CLI's copies of neededKeysOf and
// takesValue (packages/cli/src/cli/common.ts) read the plan the same way.

import {
  type EnvSchema,
  type FilePlan,
  type FileSpec,
  type PlanError,
  type ValueError,
  fileKeys,
  fileRules,
  generateValue,
  getValue,
  isTemplate,
  parseDotenv,
  ruleKeys,
  ruleNames,
  validateValue,
} from '@configure-env/core';
import { ApiError } from './http.ts';

/** A problem with one key of the inputs: `usage` misuses it, `value` has none. */
export interface KeyProblem {
  kind: 'usage' | 'value';
  key: string;
  message: string;
}

/** The 422 of inputs the run cannot take: `message` and `hints` are its lines. */
const refuse = (
  errors: KeyProblem[],
  message = `${errors[0]!.key}: ${errors[0]!.message}`,
  ...hints: string[]
) => new ApiError(422, message, { kind: 'inputs', errors, hints });

const keyProblem = (
  kind: KeyProblem['kind'],
  key: string,
  message: string,
  ...hints: string[]
) => refuse([{ kind, key, message }], undefined, ...hints);

/**
 * Whether a given value for `key` reaches `file`: one of its variables, not
 * set literally by its `values`, not a template.
 */
export const takesValue = (schema: EnvSchema, file: FileSpec, key: string) =>
  !isTemplate(file) &&
  file.values?.[key] === undefined &&
  fileKeys(schema, file).includes(key);

/**
 * The variables a file's run takes values for: every one for a generate or
 * new file, the missing keys of a merge file, none for a skipped one, a
 * chmod or a template.
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

/** The keys any of the planned files takes values for, in schema order. */
export function neededKeys(
  schema: EnvSchema,
  plans: readonly FilePlan[],
): string[] {
  const needed = new Set(plans.flatMap((plan) => neededKeysOf(schema, plan)));
  return Object.keys(schema.variables).filter((key) => needed.has(key));
}

/**
 * Refuses `generate` and `defer` keys the run cannot take, the first one in
 * apply's order: a key to generate that is not a declared secret string or
 * that is given a value too, then a deferred key that is undeclared,
 * generated, or neither required nor requiredUnless. A deferred key may be
 * given a value: the value is used.
 */
export function checkInputs(
  schema: EnvSchema,
  values: Readonly<Record<string, string>>,
  generate: readonly string[],
  defer: readonly string[],
) {
  for (const key of generate) {
    if (!Object.hasOwn(schema.variables, key))
      throw keyProblem('usage', key, 'is not declared in the schema');
    const spec = schema.variables[key]!;
    if (spec.type !== 'string' || !spec.secret)
      throw keyProblem(
        'usage',
        key,
        '--generate takes a secret string variable',
      );
  }
  for (const key of generate)
    if (Object.hasOwn(values, key))
      throw keyProblem(
        'usage',
        key,
        '--generate takes a key given no other way',
      );
  for (const key of defer) {
    if (!Object.hasOwn(schema.variables, key))
      throw keyProblem('usage', key, 'is not declared in the schema');
    if (generate.includes(key))
      throw keyProblem('usage', key, '--defer takes a key given no other way');
    const spec = schema.variables[key]!;
    if (!spec.required && spec.requiredUnless === undefined)
      throw keyProblem('usage', key, '--defer takes a required variable');
  }
}

/**
 * Refuses a generated key that a chosen generate file writes: it would get
 * a new value on every run. Merge and create-only files never change a value.
 */
export function checkGenerated(
  schema: EnvSchema,
  paths: readonly string[] | undefined,
  keys: readonly string[],
) {
  for (const file of schema.files) {
    if (paths && !paths.includes(file.path)) continue;
    if (file.policy !== 'generate') continue;
    const written = keys.filter((key) => takesValue(schema, file, key));
    const message = `--generate would rotate it on every run of ${file.path}, a generate file`;
    if (written.length)
      throw refuse(
        written.map((key) => ({ kind: 'usage', key, message })),
        `${written.join(', ')}: ${message}`,
        'pass --file to leave that file out of the run',
      );
  }
}

/** The variables `key` must not be set together with, either way round. */
const conflictsOf = (schema: EnvSchema, key: string) => [
  ...new Set([
    ...ruleNames(schema.variables[key]!.conflictsWith),
    ...Object.keys(schema.variables).filter((name) =>
      ruleNames(schema.variables[name]!.conflictsWith).includes(key),
    ),
  ]),
];

/**
 * Refuses to generate `key` while a file of the run that writes it also
 * holds a variable it conflicts with: kept from the file, or written by the
 * run (given, generated, or a default). The run would write both.
 */
function checkConflicts(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  values: Readonly<Record<string, string>>,
  generated: readonly string[],
  key: string,
) {
  for (const plan of plans) {
    if (!neededKeysOf(schema, plan).includes(key)) continue;
    const file = schema.files.find((spec) => spec.path === plan.path)!;
    const held =
      plan.previous === undefined ? undefined : parseDotenv(plan.previous);
    const listed = fileKeys(schema, file);
    for (const other of conflictsOf(schema, key)) {
      if (!listed.includes(other)) continue;
      // A value the file holds stays as it is, empty or not: a merge file
      // never changes an existing line, an existing create-only file takes
      // no key, and a generate file that writes the key is refused earlier.
      const kept = held && getValue(held, other);
      const literal = file.values?.[other];
      const fallback = schema.variables[other]!.default;
      const set =
        kept !== undefined && plan.policy !== 'generate'
          ? Boolean(kept)
          : literal !== undefined
            ? Boolean(literal)
            : Boolean(
                values[other] ||
                generated.includes(other) ||
                (fallback !== undefined && String(fallback) !== ''),
              );
      if (set)
        throw keyProblem(
          'usage',
          key,
          `--generate would set it while ${other} is set; set only one of them`,
        );
    }
  }
}

/** A random value for `key`, or the refusal of one that cannot be made. */
export function generateFor(schema: EnvSchema, key: string): string {
  const made = generateValue(schema.variables[key]!);
  if (made.ok) return made.value;
  // A value the rules never pass is the value's problem; a length or byte
  // count too short for a secret is the request's.
  throw keyProblem(
    made.message.startsWith('cannot') ? 'value' : 'usage',
    key,
    `${made.message}; set it with --prompt or --stdin`,
  );
}

/**
 * `values` plus one value per `generate` key. When a file of the run
 * already holds a non-empty value for the key, that value goes to the files
 * that lack it, so every file keeps one secret; else `make` makes one, only
 * when a file of the run will write the key. Files holding different
 * values are refused, naming the files and never a value.
 */
export function withGenerated(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  values: Readonly<Record<string, string>>,
  keys: readonly string[],
  make: (key: string) => string,
): Record<string, string> {
  const result = { ...values };
  const needed = neededKeys(schema, plans);
  for (const key of keys) {
    const held = new Map<string, string>();
    for (const plan of plans) {
      const file = schema.files.find((spec) => spec.path === plan.path)!;
      if (plan.previous === undefined || !takesValue(schema, file, key))
        continue;
      const value = getValue(parseDotenv(plan.previous), key);
      if (value) held.set(plan.path, value);
    }
    const distinct = [...new Set(held.values())];
    if (distinct.length > 1)
      throw keyProblem(
        'usage',
        key,
        `--generate found different values in ${[...held.keys()].join(', ')}`,
        'set the same value in each, or pass --file to leave one out of the run',
      );
    if (distinct[0] !== undefined) result[key] = distinct[0];
    else if (needed.includes(key)) {
      checkConflicts(schema, plans, values, keys, key);
      result[key] = make(key);
    }
  }
  return result;
}

/**
 * The required values the needed keys lack: a key with no value and no
 * default is an error, unless it is deferred: it is written empty, and
 * listed in `empty`.
 */
export function requiredErrors(
  schema: EnvSchema,
  keys: readonly string[],
  values: Readonly<Record<string, string>>,
  deferred: readonly string[],
): { errors: PlanError[]; empty: string[] } {
  const errors: PlanError[] = [];
  const empty: string[] = [];
  for (const key of keys) {
    if (values[key] !== undefined) continue;
    const spec = schema.variables[key]!;
    if (spec.default !== undefined) continue;
    if (deferred.includes(key)) {
      empty.push(key);
      continue;
    }
    const result = validateValue(spec, undefined);
    if (!result.ok) errors.push({ kind: 'value', key, message: result.error });
  }
  return { errors, empty };
}

/** A value error as one line, as the CLI prints it. */
const describe = (error: ValueError) =>
  `${error.keys?.join(', ') || error.key}: ${error.message}`;

/**
 * The rules between variables that the files a run writes would break: each
 * file's resulting values over its own keys, for the rules that name a key
 * the run writes to it. A `requiredUnless` of a `deferred` key is left for
 * a person, as a deferred required key is.
 */
export function ruleErrors(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  deferred: readonly string[],
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
      errors.set(describe(error), error);
    }
  }
  return [...errors.values()];
}

/**
 * The `empty` keys the file takes that still need a value there: a required
 * one, or a requiredUnless one whose alternatives the file leaves unset.
 */
export function leftIn(
  schema: EnvSchema,
  plan: FilePlan,
  empty: readonly string[],
): string[] {
  const needed = neededKeysOf(schema, plan);
  const spec = schema.files.find((file) => file.path === plan.path)!;
  const unsatisfied = new Set(
    fileRules(schema, spec, parseDotenv(plan.content ?? ''))
      .filter((problem) => problem.rule === 'requiredUnless')
      .map((problem) => problem.key),
  );
  return empty.filter(
    (key) =>
      needed.includes(key) &&
      (schema.variables[key]!.required || unsatisfied.has(key)),
  );
}
