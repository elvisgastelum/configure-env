// `configure-env apply`: writes the env files, in the TUI or unattended.

import { applyPlan } from '../engine/apply.ts';
import { getValue, parseDotenv } from '../engine/dotenv.ts';
import {
  type FilePlan,
  type Plan,
  fileKeys,
  planChanges,
} from '../engine/plan.ts';
import {
  type EnvSchema,
  type VariableSpec,
  isTemplate,
} from '../schema/definition.ts';
import { maskValue, validateValue } from '../schema/values.ts';
import {
  displayPath,
  type Context,
  contextOf,
  describeError,
  givenTwice,
  givenValue,
  loadContextSchema,
  NO_TERMINAL,
  neededKeys,
  neededKeysOf,
  parseCommand,
  parseSets,
  resolveValues,
  usageError,
} from './common.ts';
import { applyJson, applyStatus, fileState, planStatus } from './format.ts';
import { generateKeys, generateValue } from './generate.ts';
import { APPLY_HELP } from './help.ts';
import type { Io, Prompts } from './io.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  generate: { type: 'string', multiple: true },
  defer: { type: 'string', multiple: true },
} as const;

export async function applyCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(APPLY_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  const sets = parseSets(options.set);
  const generated = generateKeys(options.generate, (key) =>
    Object.hasOwn(schema.variables, key) ? schema.variables[key] : undefined,
  );
  for (const key of generated) {
    if (sets[key] !== undefined) throw givenTwice('--generate', key);
  }
  const deferred = deferKeys(schema, options.defer, [
    ...Object.keys(sets),
    ...generated,
  ]);
  if (context.ci || context.json) {
    checkGenerated(schema, context.files, generated);
    return applyUnattended(context, schema, sets, generated, deferred);
  }
  if (!io.isTTY) throw usageError(NO_TERMINAL);
  return applyInteractive(context, schema, sets, generated, deferred);
}

/** The keys of the repeated --defer option, each once and checked. */
function deferKeys(
  schema: EnvSchema,
  keys: readonly string[] = [],
  given: readonly string[],
): string[] {
  const unique = [...new Set(keys)];
  for (const key of unique) {
    if (!Object.hasOwn(schema.variables, key))
      throw usageError(`${key}: is not declared in the schema`);
    if (given.includes(key)) throw givenTwice('--defer', key);
  }
  return unique;
}

/** The deferred keys that end up with no value: no --set, env or default. */
const leftEmpty = (
  schema: EnvSchema,
  keys: readonly string[],
  deferred: readonly string[],
  values: Readonly<Record<string, string>>,
) =>
  keys.filter(
    (key) =>
      deferred.includes(key) &&
      values[key] === undefined &&
      schema.variables[key]!.default === undefined,
  );

/**
 * The report line for keys left for a person to set: one `set` command per
 * file of the run that takes them, with `--file` so it works with several.
 */
function deferredLine(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  keys: readonly string[],
) {
  const commands = plans
    .map((plan) => {
      const needed = neededKeysOf(schema, plan);
      const prompts = keys.filter((key) => needed.includes(key));
      return prompts.length
        ? `configure-env set --file ${plan.path} ${prompts.map((key) => `--prompt ${key}`).join(' ')}`
        : '';
    })
    .filter(Boolean);
  return `deferred: ${keys.join(', ')} (set ${keys.length > 1 ? 'them' : 'it'} with ${commands.join(', and ')})`;
}

/**
 * Refuses a generated key that a chosen generate file writes: it would get
 * a new value on every run. Merge and create-only files never change a value.
 */
function checkGenerated(
  schema: EnvSchema,
  paths: readonly string[] | undefined,
  keys: readonly string[],
) {
  for (const file of schema.files) {
    if (paths && !paths.includes(file.path)) continue;
    if (file.policy !== 'generate' || isTemplate(file)) continue;
    const written = fileKeys(schema, file).filter(
      (key) => keys.includes(key) && file.values?.[key] === undefined,
    );
    if (written.length)
      throw usageError(
        `${written.join(', ')}: --generate would rotate it on every run of ${file.path}, a generate file`,
        'pass --file to leave that file out of the run',
      );
  }
}

/**
 * The --set values plus one value per --generate key: the one the run's
 * files already hold, else a random one. A file that lost the key, or a new
 * one, so takes the secret the others keep. Values that differ exit 2,
 * naming the files and never a value.
 */
function withGenerated(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  sets: Readonly<Record<string, string>>,
  keys: readonly string[],
): Record<string, string> {
  const values = { ...sets };
  for (const key of keys) {
    const held = new Map<string, string>();
    for (const plan of plans) {
      const file = schema.files.find((spec) => spec.path === plan.path)!;
      if (isTemplate(file) || file.values?.[key] !== undefined) continue;
      if (plan.previous === undefined || !fileKeys(schema, file).includes(key))
        continue;
      const value = getValue(parseDotenv(plan.previous), key);
      if (value) held.set(plan.path, value);
    }
    const distinct = [...new Set(held.values())];
    if (distinct.length > 1)
      throw usageError(
        `${key}: --generate found different values in ${[...held.keys()].join(', ')}`,
        'set the same value in each, or pass --file to leave one out of the run',
      );
    values[key] = distinct[0] ?? generateValue(key, schema.variables[key]!);
  }
  return values;
}

const toWrite = (plan: Plan) =>
  plan.files.some(
    (file) => file.action === 'create' || file.action === 'update',
  );

async function applyUnattended(
  { io, root, files, json }: Context,
  schema: EnvSchema,
  sets: Readonly<Record<string, string>>,
  generated: readonly string[],
  deferred: readonly string[],
): Promise<number> {
  const first = await planChanges({ schema, root, values: {}, files });
  const givenValues = withGenerated(schema, first.files, sets, generated);
  const keys = neededKeys(schema, first.files);
  const { values, errors } = resolveValues(
    schema,
    keys,
    givenValues,
    io.env,
    deferred,
  );
  const plan = await planChanges({ schema, root, values, files });
  errors.push(...plan.errors);
  const empty = leftEmpty(schema, keys, deferred, values);

  if (errors.length) {
    if (json)
      io.stdout(
        JSON.stringify({
          command: 'apply',
          ok: false,
          errors,
          files: plan.files.map((file) => applyJson(file)),
          deferred: empty,
        }),
      );
    else {
      errors.forEach((error) =>
        io.stderr(`configure-env: ${describeError(error)}`),
      );
      plan.files
        .filter((file) => file.reason === 'refused')
        .forEach((file) => io.stdout(`${file.path}: ${applyStatus(file)}`));
    }
    return 1;
  }

  const results = await applyPlan(plan);
  const ok = results.every((result) => result.ok);
  if (json)
    io.stdout(
      JSON.stringify({
        command: 'apply',
        ok,
        errors: [],
        files: plan.files.map((file, i) => applyJson(file, results[i])),
        deferred: empty,
      }),
    );
  else {
    plan.files.forEach((file, i) =>
      io.stdout(`${file.path}: ${applyStatus(file, results[i])}`),
    );
    if (empty.length) io.stdout(deferredLine(schema, plan.files, empty));
  }
  return ok ? 0 : 1;
}

const CANCELLED = 130;

function cancelled(prompts: Prompts): number {
  prompts.cancel('Cancelled; nothing was written.');
  return CANCELLED;
}

/** The prompt message: the description and the name, or the name alone. */
const messageOf = (key: string, spec: VariableSpec) =>
  spec.description ? `${spec.description} (${key})` : key;

/** The variable's prompt by type; the answer as env text, or a cancel. */
export async function ask(
  prompts: Prompts,
  key: string,
  spec: VariableSpec,
  initial: string,
): Promise<string | symbol> {
  const message = messageOf(key, spec);
  const validate = (value: string | undefined) => {
    const result = validateValue(spec, value ?? '');
    return result.ok ? undefined : result.error;
  };
  if (spec.type === 'enum')
    return prompts.select({
      message,
      options: spec.values.map((value) => ({ value, label: value })),
      ...(spec.values.includes(initial) ? { initialValue: initial } : {}),
    });
  if (spec.type === 'boolean') {
    const parsed = validateValue(spec, initial);
    const answer = await prompts.confirm({
      message,
      initialValue: parsed.ok && parsed.value === true,
    });
    return prompts.isCancel(answer) ? answer : String(answer);
  }
  if (spec.secret) return prompts.password({ message, validate });
  const fallback =
    spec.default === undefined ? '' : formatDefault(spec, spec.default);
  return prompts.text({
    message,
    placeholder: fallback,
    initialValue: initial,
    validate,
  });
}

const formatDefault = (spec: VariableSpec, value: string | number | boolean) =>
  validateValue(spec, String(value)).ok ? String(value) : '';

/** The needed keys, grouped by `group` in order of first appearance. */
function byGroup(schema: EnvSchema, keys: readonly string[]) {
  const groups = new Map<string | undefined, string[]>();
  for (const key of keys) {
    const group = schema.variables[key]!.group;
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }
  return groups;
}

/** One plan line per file, with the prompted values it takes, masked. */
function previewLines(
  schema: EnvSchema,
  plan: Plan,
  answers: Readonly<Record<string, string>>,
): string[] {
  return plan.files.map((file: FilePlan) => {
    const shown = neededKeysOf(schema, file)
      .filter((key) => answers[key] !== undefined)
      .map((key) => {
        const spec = schema.variables[key]!;
        return `${key}=${maskValue(spec, answers[key]!)}`;
      });
    const values = shown.length ? ` (${shown.join(', ')})` : '';
    return `${file.path}: ${planStatus(file)}${values}`;
  });
}

async function applyInteractive(
  { io, prompts, root, files, schemaPath }: Context,
  schema: EnvSchema,
  sets: Readonly<Record<string, string>>,
  generated: readonly string[],
  deferred: readonly string[],
): Promise<number> {
  prompts.intro(`configure-env · ${displayPath(io.cwd, schemaPath)}`);

  const first = await planChanges({ schema, root, values: {}, files });
  const picked = await prompts.multiselect<string>({
    message: 'Which files should be written?',
    options: first.files.map((file) => ({
      value: file.path,
      label: file.path,
      hint: `${file.policy}; ${fileState(file)}`,
    })),
    initialValues: first.files
      .filter((file) => file.action === 'create' || file.action === 'update')
      .map((file) => file.path),
    required: true,
  });
  if (prompts.isCancel(picked)) return cancelled(prompts);
  checkGenerated(schema, picked, generated);
  const givenValues = withGenerated(
    schema,
    first.files.filter((file) => picked.includes(file.path)),
    sets,
    generated,
  );

  let refused = false;
  const selected: FilePlan[] = [];
  for (const file of first.files) {
    if (!picked.includes(file.path)) continue;
    if (file.reason === 'refused') {
      prompts.log.warn(`${file.path}: refused: ${file.error}`);
      refused = true;
    } else if (file.reason === 'exists') {
      prompts.log.info(
        `${file.path}: exists; create-only files are never overwritten`,
      );
    } else selected.push(file);
  }
  const failure = refused ? 1 : 0;
  if (!selected.length) {
    prompts.outro('Nothing to write.');
    return failure;
  }

  const answers: Record<string, string> = {};
  const needed = neededKeys(schema, selected);
  for (const [group, keys] of byGroup(schema, needed)) {
    if (group) prompts.log.step(group);
    for (const key of keys) {
      // A --set or generated value is the answer already.
      if (givenValues[key] !== undefined) continue;
      // A deferred key takes only its environment variable, else its default.
      if (deferred.includes(key)) {
        const given = givenValue(key, {}, io.env);
        if (given !== undefined) answers[key] = given;
        continue;
      }
      const spec = schema.variables[key]!;
      const initial =
        givenValue(key, {}, io.env) ??
        (spec.default === undefined ? '' : formatDefault(spec, spec.default));
      const answer = await ask(prompts, key, spec, initial);
      if (prompts.isCancel(answer)) return cancelled(prompts);
      answers[key] = answer;
    }
  }

  const plan = await planChanges({
    schema,
    root,
    values: { ...givenValues, ...answers },
    files: selected.map((file) => file.path),
  });
  if (plan.errors.length) {
    prompts.log.error(plan.errors.map(describeError).join('\n'));
    prompts.outro('Nothing was written.');
    return 1;
  }
  prompts.note(
    previewLines(schema, plan, { ...givenValues, ...answers }).join('\n'),
    'Plan',
  );
  if (!toWrite(plan)) {
    prompts.outro('Everything is current.');
    return failure;
  }

  const go = await prompts.confirm({ message: 'Write these changes?' });
  if (prompts.isCancel(go)) return cancelled(prompts);
  if (!go) {
    prompts.outro('Nothing was written.');
    return failure;
  }

  const progress = prompts.spinner();
  progress.start('Writing');
  const results = await applyPlan(plan);
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    progress.error(`${failed.length} of ${results.length} files failed`);
    failed.forEach((result) =>
      prompts.log.error(`${result.path}: ${result.error}`),
    );
    prompts.outro('Some files were not written.');
    return 1;
  }
  progress.stop('Written');
  const empty = leftEmpty(schema, needed, deferred, {
    ...givenValues,
    ...answers,
  });
  prompts.outro(
    [
      ...plan.files.map(
        (file, i) => `${file.path}: ${applyStatus(file, results[i])}`,
      ),
      ...(empty.length ? [deferredLine(schema, plan.files, empty)] : []),
    ].join('\n'),
  );
  return failure;
}
