// `configure-env apply`: writes the env files, in the TUI or unattended.

import { applyPlan } from '../engine/apply.ts';
import { type FilePlan, type Plan, planChanges } from '../engine/plan.ts';
import type { EnvSchema, VariableSpec } from '../schema/definition.ts';
import { maskValue, validateValue } from '../schema/values.ts';
import {
  displayPath,
  type Context,
  contextOf,
  describeError,
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
import { APPLY_HELP } from './help.ts';
import type { Io, Prompts } from './io.ts';

const OPTIONS = { set: { type: 'string', multiple: true } } as const;

export async function applyCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(APPLY_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  const sets = parseSets(options.set);
  if (context.ci || context.json) return applyUnattended(context, schema, sets);
  if (!io.isTTY) throw usageError(NO_TERMINAL);
  return applyInteractive(context, schema, sets);
}

const toWrite = (plan: Plan) =>
  plan.files.some(
    (file) => file.action === 'create' || file.action === 'update',
  );

async function applyUnattended(
  { io, root, files, json }: Context,
  schema: EnvSchema,
  sets: Record<string, string>,
): Promise<number> {
  const first = await planChanges({ schema, root, values: {}, files });
  const keys = neededKeys(schema, first.files);
  const { values, errors } = resolveValues(schema, keys, sets, io.env);
  const plan = await planChanges({ schema, root, values, files });
  errors.push(...plan.errors);

  if (errors.length) {
    if (json)
      io.stdout(
        JSON.stringify({
          command: 'apply',
          ok: false,
          errors,
          files: plan.files.map((file) => applyJson(file)),
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
      }),
    );
  else
    plan.files.forEach((file, i) =>
      io.stdout(`${file.path}: ${applyStatus(file, results[i])}`),
    );
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
  sets: Record<string, string>,
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
  for (const [group, keys] of byGroup(schema, neededKeys(schema, selected))) {
    if (group) prompts.log.step(group);
    for (const key of keys) {
      // A --set value is the answer already.
      if (sets[key] !== undefined) continue;
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
    values: { ...sets, ...answers },
    files: selected.map((file) => file.path),
  });
  if (plan.errors.length) {
    prompts.log.error(plan.errors.map(describeError).join('\n'));
    prompts.outro('Nothing was written.');
    return 1;
  }
  prompts.note(
    previewLines(schema, plan, { ...sets, ...answers }).join('\n'),
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
  prompts.outro(
    plan.files
      .map((file, i) => `${file.path}: ${applyStatus(file, results[i])}`)
      .join('\n'),
  );
  return failure;
}
