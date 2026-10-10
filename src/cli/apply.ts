// `configure-env apply`: writes the env files, in the TUI or unattended.

import { type ApplyResult, applyPlan } from '../engine/apply.ts';
import { getValue, parseDotenv } from '../engine/dotenv.ts';
import {
  type FilePlan,
  type Plan,
  type PlanError,
  planChanges,
} from '../engine/plan.ts';
import { fileRules } from '../engine/check.ts';
import type { EnvSchema, VariableSpec } from '../schema/definition.ts';
import { maskValue, validateValue } from '../schema/values.ts';
import {
  CliError,
  displayPath,
  type Context,
  contextOf,
  describeError,
  givenTwice,
  givenValue,
  keyError,
  type KeyProblem,
  loadContextSchema,
  NO_TERMINAL,
  neededKeys,
  neededKeysOf,
  takesValue,
  parseCommand,
  parseSets,
  resolveValues,
  ruleErrors,
  usageError,
} from './common.ts';
import { applyJson, applyStatus, fileState, planStatus } from './format.ts';
import { checkConflict, generateKeys, generateValue } from './generate.ts';
import { APPLY_HELP } from './help.ts';
import type { Io, Prompts } from './io.ts';
import {
  type RunState,
  type ProtectedCheck,
  type Replaced,
  type RunFile,
  checksOf,
  confirmReplacements,
  loadRunState,
  protectedLine,
  replaceKeys,
  verdictsOf,
  writeProtected,
} from './protect.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  generate: { type: 'string', multiple: true },
  defer: { type: 'string', multiple: true },
  'replace-protected': { type: 'string', multiple: true },
} as const;

export async function applyCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(APPLY_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  try {
    return await applyWith(context, schema, options);
  } catch (error) {
    // A failure about a key is a failed run: --json prints it as one, with
    // the same exit code. Nothing was written.
    if (!context.json || !(error instanceof CliError) || !error.errors)
      throw error;
    io.stdout(failureJson(error.errors, []));
    return error.code;
  }
}

/** The JSON document of a run that failed and wrote nothing. */
const failureJson = (
  errors: readonly (PlanError | KeyProblem)[],
  files: readonly FilePlan[],
) =>
  JSON.stringify({
    command: 'apply',
    ok: false,
    errors,
    files: files.map((file) => applyJson(file)),
    // Nothing was written, so no key was left empty.
    deferred: [],
  });

async function applyWith(
  context: Context,
  schema: EnvSchema,
  options: ReturnType<typeof parseCommand<typeof OPTIONS>>,
): Promise<number> {
  const { io } = context;
  const sets = parseSets(options.set);
  const generated = generateKeys(
    options.generate,
    (key) =>
      Object.hasOwn(schema.variables, key) ? schema.variables[key] : undefined,
    schema,
  );
  for (const key of generated) {
    if (sets[key] !== undefined) throw givenTwice('--generate', key);
  }
  const deferred = deferKeys(
    schema,
    [...Object.keys(sets), ...generated],
    options.defer,
  );
  const guard: Guard = {
    run: undefined,
    replace: replaceKeys(schema, options['replace-protected']),
  };
  if (context.ci || context.json) {
    checkGenerated(schema, context.files, generated);
    guard.run = await loadRunState(context, schema);
    return applyUnattended(context, schema, sets, generated, deferred, guard);
  }
  if (!io.isTTY) throw usageError(NO_TERMINAL);
  guard.run = await loadRunState(context, schema);
  return applyInteractive(context, schema, sets, generated, deferred, guard);
}

/** The protected variables' state of a run and its --replace-protected keys. */
interface Guard {
  run: RunState | undefined;
  replace: ReadonlySet<string>;
}

/**
 * The protected checks of every file the run writes, and the values of every
 * file it leaves as planned, for recording.
 */
function runChecks(schema: EnvSchema, plan: Plan) {
  const checks: ProtectedCheck[] = [];
  const files: RunFile[] = [];
  for (const file of plan.files) {
    if (file.reason === 'refused') continue;
    const spec = schema.files.find((entry) => entry.path === file.path)!;
    const content = file.content ?? file.previous;
    if (content !== undefined) {
      const doc = parseDotenv(content);
      files.push({ spec, valueOf: (key) => getValue(doc, key) });
    }
    if (file.action !== 'create' && file.action !== 'update') continue;
    const before =
      file.previous === undefined ? undefined : parseDotenv(file.previous);
    const after = parseDotenv(file.content ?? '');
    checks.push(
      ...checksOf(
        schema,
        spec,
        (key) => before && getValue(before, key),
        (key) => getValue(after, key),
      ),
    );
  }
  return { checks, files };
}

/**
 * Checks every protected key the planned files would write, against the
 * state the run read, before any is written: the refusals, and the keys
 * --replace-protected replaces.
 */
const protectedChanges = (
  schema: EnvSchema,
  { run, replace }: Guard,
  plan: Plan,
) =>
  run
    ? verdictsOf(schema, run.state, runChecks(schema, plan).checks, replace)
    : { refused: [], replaced: [] as Replaced[] };

/**
 * Writes the plan, under the state's lock when it touches protected values
 * (see writeProtected), settling its checks and values with the state as it
 * is then. `allowed` are the keys --replace-protected may replace.
 */
function writeRun(
  context: Context,
  schema: EnvSchema,
  guard: Guard,
  plan: Plan,
  allowed: ReadonlySet<string>,
) {
  const { checks, files } = runChecks(schema, plan);
  return writeProtected(
    context,
    schema,
    guard.run,
    { checks, files, replace: allowed },
    async () => {
      const results = await applyPlan(plan);
      const paths = (keep: (file: FilePlan, i: number) => boolean) =>
        plan.files.filter(keep).map((file) => file.path);
      return {
        value: results,
        // The files left as planned: the rule runChecks records by.
        done: paths(
          (file, i) => Boolean(results[i]?.ok) && file.reason !== 'refused',
        ),
        written: paths((_, i) => Boolean(results[i]?.written)),
      };
    },
  );
}

const replacedLines = (replaced: readonly Replaced[]) =>
  replaced.map(({ file, key }) => `${file}: replaced protected ${key}`);

/** The keys of the repeated --defer option, each once and checked. */
function deferKeys(
  schema: EnvSchema,
  given: readonly string[],
  keys: readonly string[] = [],
): string[] {
  const unique = [...new Set(keys)];
  for (const key of unique) {
    if (!Object.hasOwn(schema.variables, key))
      throw keyError('usage', key, 'is not declared in the schema');
    if (given.includes(key)) throw givenTwice('--defer', key);
    // A requiredUnless variable is required while its alternatives are unset.
    const spec = schema.variables[key]!;
    if (!spec.required && spec.requiredUnless === undefined)
      throw keyError('usage', key, '--defer takes a required variable');
  }
  return unique;
}

/**
 * The keys left empty that the written files hold, and those files: a file
 * that failed to write leaves nothing for a person to set.
 */
function writtenEmpty(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  results: readonly ApplyResult[],
  empty: readonly string[],
) {
  const written = plans.filter((_, i) => results[i]?.ok);
  const left = new Set(written.flatMap((plan) => leftIn(schema, plan, empty)));
  return { written, keys: empty.filter((key) => left.has(key)) };
}

/**
 * The `empty` keys the file takes that still need a value there: a required
 * one, or a requiredUnless one whose alternatives the file leaves unset.
 */
function leftIn(
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
      const prompts = leftIn(schema, plan, keys);
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
    if (file.policy !== 'generate') continue;
    const written = keys.filter((key) => takesValue(schema, file, key));
    const message = `--generate would rotate it on every run of ${file.path}, a generate file`;
    if (written.length)
      throw new CliError(
        2,
        [
          `${written.join(', ')}: ${message}`,
          'pass --file to leave that file out of the run',
        ],
        written.map((key) => ({ kind: 'usage', key, message })),
      );
  }
}

/**
 * The --set values plus one value per --generate key. When a file of the
 * run already holds a non-empty value for the key, that value goes to the
 * files that lack it, so every file keeps one secret; else a random value
 * is made, only when a file of the run will write the key. Files holding
 * different values exit 2, naming the files and never a value.
 */
function withGenerated(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  sets: Readonly<Record<string, string>>,
  keys: readonly string[],
  env: Io['env'],
): Record<string, string> {
  const values = { ...sets };
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
      throw keyError(
        'usage',
        key,
        `--generate found different values in ${[...held.keys()].join(', ')}`,
        'set the same value in each, or pass --file to leave one out of the run',
      );
    if (distinct[0] !== undefined) values[key] = distinct[0];
    else if (needed.includes(key)) {
      checkConflicts(schema, plans, sets, keys, env, key);
      values[key] = generateValue(key, schema.variables[key]!);
    }
  }
  return values;
}

/**
 * Refuses to generate `key` while a file of the run that writes it also
 * holds a variable it conflicts with: kept from the file, or written by the
 * run (`values`, given, generated, from the environment, or a default).
 * The run would write both. A file without the partner holds no conflict.
 */
function checkConflicts(
  schema: EnvSchema,
  plans: readonly FilePlan[],
  sets: Readonly<Record<string, string>>,
  generated: readonly string[],
  env: Io['env'],
  key: string,
) {
  for (const plan of plans) {
    if (!neededKeysOf(schema, plan).includes(key)) continue;
    const file = schema.files.find((spec) => spec.path === plan.path)!;
    const held =
      plan.previous === undefined ? undefined : parseDotenv(plan.previous);
    checkConflict(schema, file, key, (other) => {
      // A value the file holds stays as it is, empty or not: a merge file
      // never changes an existing line, an existing create-only file takes
      // no key, and a generate file that writes the key is refused earlier.
      const kept = held && getValue(held, other);
      if (kept !== undefined && plan.policy !== 'generate')
        return Boolean(kept);
      const literal = file.values?.[other];
      if (literal !== undefined) return Boolean(literal);
      const fallback = schema.variables[other]!.default;
      return Boolean(
        givenValue(other, sets, env) ||
        generated.includes(other) ||
        (fallback !== undefined && String(fallback) !== ''),
      );
    });
  }
}

const toWrite = (plan: Plan) =>
  plan.files.some(
    (file) => file.action === 'create' || file.action === 'update',
  );

async function applyUnattended(
  context: Context,
  schema: EnvSchema,
  sets: Readonly<Record<string, string>>,
  generated: readonly string[],
  deferred: readonly string[],
  guard: Guard,
): Promise<number> {
  const { io, root, files, json } = context;
  const first = await planChanges({ schema, root, values: {}, files });
  const givenValues = withGenerated(
    schema,
    first.files,
    sets,
    generated,
    io.env,
  );
  const keys = neededKeys(schema, first.files);
  const { values, errors, empty } = resolveValues(
    schema,
    keys,
    givenValues,
    io.env,
    deferred,
  );
  const plan = await planChanges({ schema, root, values, files });
  errors.push(...plan.errors);
  // Like a required value, a broken rule between variables writes nothing.
  if (!errors.length) errors.push(...ruleErrors(schema, plan.files, deferred));

  if (errors.length) {
    if (json) io.stdout(failureJson(errors, plan.files));
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

  // A protected value never changes without --replace-protected: a refusal
  // writes nothing.
  const { refused } = protectedChanges(schema, guard, plan);
  if (refused.length) {
    if (json) io.stdout(failureJson(refused, plan.files));
    else
      refused.forEach((problem) =>
        io.stderr(`configure-env: ${protectedLine(problem)}`),
      );
    return 2;
  }

  let written: Awaited<ReturnType<typeof writeRun>>;
  try {
    written = await writeRun(context, schema, guard, plan, guard.replace);
  } catch (error) {
    // Refused under the state's lock, or no lock: nothing was written.
    if (!(error instanceof CliError) || !error.errors) throw error;
    if (json) io.stdout(failureJson(error.errors, plan.files));
    else
      error.lines.forEach((line, i) =>
        io.stderr(
          i && error.errors![0]!.kind === 'file'
            ? line
            : `configure-env: ${line}`,
        ),
      );
    return error.code;
  }
  const { value: results, replaced, stateError } = written;
  const ok = results.every((result) => result.ok) && !stateError;
  const left = writtenEmpty(schema, plan.files, results, empty);
  const done = replaced.filter((entry) =>
    plan.files.some((file, i) => file.path === entry.file && results[i]?.ok),
  );
  if (json)
    io.stdout(
      JSON.stringify({
        command: 'apply',
        ok,
        errors: stateError
          ? [
              {
                kind: 'file',
                path: displayPath(io.cwd, guard.run!.path),
                message: stateError.join('; '),
              },
            ]
          : [],
        files: plan.files.map((file, i) => applyJson(file, results[i])),
        deferred: left.keys,
        ...(done.length ? { replaced: done } : {}),
      }),
    );
  else {
    plan.files.forEach((file, i) =>
      io.stdout(`${file.path}: ${applyStatus(file, results[i])}`),
    );
    replacedLines(done).forEach((line) => io.stdout(line));
    if (left.keys.length)
      io.stdout(deferredLine(schema, left.written, left.keys));
    stateError?.forEach((line, i) =>
      io.stderr(i ? line : `configure-env: ${line}`),
    );
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
  context: Context,
  schema: EnvSchema,
  sets: Readonly<Record<string, string>>,
  generated: readonly string[],
  deferred: readonly string[],
  guard: Guard,
): Promise<number> {
  const { io, prompts, root, files, schemaPath } = context;
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
  let givenValues: Record<string, string>;
  try {
    checkGenerated(schema, picked, generated);
    givenValues = withGenerated(
      schema,
      first.files.filter((file) => picked.includes(file.path)),
      sets,
      generated,
      io.env,
    );
  } catch (error) {
    // The prompts are open: close them with the error, not a bare exit.
    if (!(error instanceof CliError)) throw error;
    prompts.log.error(error.lines.join('\n'));
    prompts.outro('Nothing was written.');
    return error.code;
  }

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

  const needed = neededKeys(schema, selected);
  // A deferred key is never asked: it resolves as in an unattended run, to
  // its environment variable, else its default, else empty.
  const { values: resolved, empty } = resolveValues(
    schema,
    needed.filter((key) => deferred.includes(key)),
    givenValues,
    io.env,
    deferred,
  );
  const answers: Record<string, string> = {};
  for (const [group, keys] of byGroup(schema, needed)) {
    if (group) prompts.log.step(group);
    for (const key of keys) {
      // A --set or generated value is the answer already.
      if (givenValues[key] !== undefined) continue;
      if (deferred.includes(key)) {
        if (resolved[key] !== undefined) answers[key] = resolved[key];
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
  const planErrors = plan.errors.length
    ? plan.errors
    : ruleErrors(schema, plan.files, deferred);
  if (planErrors.length) {
    prompts.log.error(planErrors.map(describeError).join('\n'));
    prompts.outro('Nothing was written.');
    return 1;
  }
  const { refused: blocked, replaced } = protectedChanges(schema, guard, plan);
  if (blocked.length) {
    prompts.log.error(blocked.map(protectedLine).join('\n'));
    prompts.outro('Nothing was written.');
    return 2;
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
  try {
    const keys = [...new Set(replaced.map((entry) => entry.key))];
    if (!(await confirmReplacements(context, keys))) return cancelled(prompts);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    prompts.log.error(error.lines.join('\n'));
    prompts.outro('Nothing was written.');
    return error.code;
  }

  const progress = prompts.spinner();
  progress.start('Writing');
  let written: Awaited<ReturnType<typeof writeRun>>;
  try {
    const confirmed = new Set(replaced.map((entry) => entry.key));
    written = await writeRun(context, schema, guard, plan, confirmed);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    progress.error('Not written');
    prompts.log.error(error.lines.join('\n'));
    prompts.outro('Nothing was written.');
    return error.code;
  }
  const { value: results, stateError } = written;
  const left = writtenEmpty(schema, plan.files, results, empty);
  const deferredLines = left.keys.length
    ? [deferredLine(schema, left.written, left.keys)]
    : [];
  const done = written.replaced.filter((entry) =>
    plan.files.some((file, i) => file.path === entry.file && results[i]?.ok),
  );
  if (stateError) prompts.log.error(stateError.join('\n'));
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    progress.error(`${failed.length} of ${results.length} files failed`);
    failed.forEach((result) =>
      prompts.log.error(`${result.path}: ${result.error}`),
    );
    prompts.outro(
      ['Some files were not written.', ...deferredLines].join('\n'),
    );
    return 1;
  }
  progress.stop('Written');
  prompts.outro(
    [
      ...plan.files.map(
        (file, i) => `${file.path}: ${applyStatus(file, results[i])}`,
      ),
      ...replacedLines(done),
      ...deferredLines,
    ].join('\n'),
  );
  return stateError ? 1 : failure;
}
