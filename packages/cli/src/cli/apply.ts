// `configure-env apply`: writes the env files, in the TUI or unattended. It
// runs through the configure-env API (connect.ts), against the local project
// or another environment: POST /api/plan shows what the run would do, and
// POST /api/apply writes that plan, named by its fingerprint. The values come
// from here (--set, the environment, the prompts); a --generate value is made
// on the server, which never answers it.

import {
  type Applied,
  type ApplyRequest,
  type Plan as ApiPlan,
  type FilePlan as ApiFilePlan,
  type PlanRequest,
  applyPlan,
  planChanges,
} from '@configure-env/api-client/client';
import {
  type ApplyResult,
  type EnvSchema,
  type PlanError,
  type SchemaError,
  type VariableSpec,
  displayPath,
  maskValue,
  validateValue,
} from '@configure-env/core';
import {
  CliError,
  describeError,
  givenTwice,
  givenValue,
  keyError,
  type KeyProblem,
  NO_TERMINAL,
  neededKeys,
  neededKeysOf,
  takesValue,
  parseCommand,
  parseSets,
  usageError,
} from './common.ts';
import {
  type Connection,
  type ProjectRun,
  answerMessage,
  openProject,
  send,
} from './connect.ts';
import {
  type PlannedFile,
  applyJson,
  applyStatus,
  fileState,
  planStatus,
} from './format.ts';
import { generateKeys } from './generate.ts';
import { APPLY_HELP } from './help.ts';
import type { Io, Prompts } from './io.ts';
import {
  type ProtectedProblem,
  type Replaced,
  confirmReplacements,
  protectedLine,
  replaceKeys,
} from './protect.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  generate: { type: 'string', multiple: true },
  defer: { type: 'string', multiple: true },
  'replace-protected': { type: 'string', multiple: true },
  prune: { type: 'boolean' },
} as const;

/** What a run takes from its options, checked. */
interface Inputs {
  sets: Record<string, string>;
  generated: string[];
  deferred: string[];
  replace: string[];
  prune: boolean;
}

/** A file of the API's plan, as the formatters read one. */
type RunFile = PlannedFile & {
  /** The deferred keys the file is left without a value for. */
  deferred: string[];
};

export async function applyCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(APPLY_HELP);
    return 0;
  }
  const run = await openProject(io, options);
  try {
    return await applyWith(io, run, options);
  } catch (error) {
    // A failure about a key is a failed run: --json prints it as one, with
    // the same exit code. Nothing was written.
    if (!run.json || !(error instanceof CliError) || !error.errors) throw error;
    io.stdout(failureJson(error.errors, []));
    return error.code;
  }
}

/** The JSON document of a run that failed and wrote nothing. */
const failureJson = (
  errors: readonly (PlanError | KeyProblem)[],
  files: readonly RunFile[],
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
  io: Io,
  run: ProjectRun,
  options: ReturnType<typeof parseCommand<typeof OPTIONS>>,
): Promise<number> {
  const { schema } = run;
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
  const inputs: Inputs = {
    sets,
    generated,
    deferred,
    replace: [...replaceKeys(schema, options['replace-protected'])],
    prune: Boolean(options.prune),
  };
  if (run.ci || run.json) {
    checkGenerated(schema, run.files, generated);
    return connected(run, (connection) =>
      applyUnattended(io, run, connection, inputs),
    );
  }
  if (!io.isTTY) throw usageError(NO_TERMINAL);
  return connected(run, (connection) =>
    applyInteractive(io, run, connection, inputs),
  );
}

/** Runs `work` over the run's server, closed after. */
async function connected<T>(
  run: ProjectRun,
  work: (connection: Connection) => Promise<T>,
): Promise<T> {
  const connection = await run.connect();
  try {
    return await work(connection);
  } finally {
    await connection.close();
  }
}

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

/** The API's file plan with its modes read, as the formatters take it. */
const runFile =
  (schema: EnvSchema) =>
  (file: ApiFilePlan): RunFile => ({
    path: file.path,
    policy: file.policy,
    action: file.action,
    addedKeys: file.addedKeys,
    prunedKeys: file.prunedKeys,
    ...(file.reason ? { reason: file.reason } : {}),
    ...(file.error === undefined ? {} : { error: file.error }),
    mode: Number.parseInt(file.mode, 8),
    ...(file.currentMode === null
      ? {}
      : { currentMode: Number.parseInt(file.currentMode, 8) }),
    ...(schema.files.find((spec) => spec.path === file.path)?.mode
      ? { modeFixed: true }
      : {}),
    exists: file.fingerprint !== null,
    deferred: file.deferred ?? [],
  });

/** The error a refused request ends the run with. */
function requestError(
  run: ProjectRun,
  response: { status: number; data: unknown },
): CliError {
  const data = response.data as {
    kind?: string;
    message?: string;
    errors?: unknown[];
    hints?: string[];
    lines?: string[];
  } | null;
  if (response.status === 422 && data?.kind === 'inputs') {
    const errors = data.errors as KeyProblem[];
    const usage = errors.some((error) => error.kind === 'usage');
    return new CliError(
      usage ? 2 : 1,
      [data.message!, ...(data.hints ?? [])],
      errors,
    );
  }
  if (response.status === 422 && !('plan' in (data ?? {})))
    return new CliError(1, [
      `invalid schema ${run.title}:`,
      ...((data?.errors ?? []) as SchemaError[]).map(
        (error) => `  ${error.path}: ${error.message}`,
      ),
    ]);
  // The state a plan reads when the schema protects a variable.
  if (response.status === 503)
    return new CliError(1, [
      answerMessage(response),
      'fix or restore it; nothing was written',
    ]);
  return new CliError(1, [answerMessage(response)]);
}

/** POST /api/plan, or the error the run ends with. */
async function planOf(
  run: ProjectRun,
  connection: Connection,
  body: PlanRequest,
): Promise<ApiPlan> {
  const response = await send(connection, () =>
    planChanges(body, connection.init()),
  );
  if (response.status === 200) return response.data;
  throw requestError(run, response);
}

/**
 * The values a run plans with: the --set values, then the non-empty
 * environment variable of each key the files take that is neither set nor
 * generated. The server falls back to the default.
 */
function valuesFor(
  schema: EnvSchema,
  files: readonly ApiFilePlan[],
  { sets, generated }: Inputs,
  env: Io['env'],
): Record<string, string> {
  const values = { ...sets };
  for (const key of neededKeys(schema, files)) {
    if (sets[key] !== undefined || generated.includes(key)) continue;
    const value = givenValue(key, {}, env);
    if (value !== undefined) values[key] = value;
  }
  return values;
}

/** The plan request of a run: apply's checks on (`defer`), every input. */
const runRequest = (
  run: ProjectRun,
  inputs: Inputs,
  values: Record<string, string>,
  files = run.files,
): PlanRequest => ({
  values,
  ...(files ? { files } : {}),
  prune: inputs.prune,
  generate: inputs.generated,
  defer: inputs.deferred,
  ...(inputs.replace.length ? { replaceProtected: inputs.replace } : {}),
});

/** The protected refusals of a plan, as the CLI's problems. */
const refusalsOf = (plan: ApiPlan): ProtectedProblem[] =>
  plan.protected.map(({ key, message, reason }) => ({
    kind: 'protected',
    key,
    message,
    ...(reason ? { reason } : {}),
  }));

/** A failed POST /api/apply: why nothing was written, and the exit code. */
type ApplyFailure =
  | { kind: 'plan'; plan: ApiPlan }
  | { kind: 'error'; error: CliError };

/** POST /api/apply of the plan shown: what it wrote, or why it wrote nothing. */
async function applyShown(
  io: Io,
  run: ProjectRun,
  connection: Connection,
  body: PlanRequest,
  plan: ApiPlan,
): Promise<{ ok: true; applied: Applied } | ({ ok: false } & ApplyFailure)> {
  const request: ApplyRequest = { ...body, fingerprint: plan.fingerprint };
  const response = await send(connection, () =>
    applyPlan(request, connection.init()),
  );
  if (response.status === 200) return { ok: true, applied: response.data };
  const data = response.data as {
    plan?: ApiPlan;
    path?: string;
    lines?: string[];
  };
  // Refused when written: errors, or protected values the state now holds.
  if (response.status === 422 && data.plan)
    return { ok: false, kind: 'plan', plan: data.plan };
  if (response.status === 503 && data.lines && data.path) {
    const path = shownPath(io, run, data.path);
    return {
      ok: false,
      kind: 'error',
      error: new CliError(1, data.lines, [
        { kind: 'file', path, message: data.lines.join('; ') },
      ]),
    };
  }
  return { ok: false, kind: 'error', error: requestError(run, response) };
}

/** A path of the server's, as this run shows it. */
const shownPath = (io: Io, run: ProjectRun, path: string) =>
  run.remote ? path : displayPath(io.cwd, path);

/** `all` without the lines of `lines`, each once. */
function without(all: readonly string[], lines: readonly string[]) {
  const left = [...lines];
  return all.filter((line) => {
    const at = left.indexOf(line);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

/**
 * The keys left empty that the written files hold, in schema order, and
 * those files: a file that failed to write leaves nothing for a person to set.
 */
function writtenEmpty(
  schema: EnvSchema,
  files: readonly RunFile[],
  resultOf: (file: RunFile) => ApplyResult | undefined,
) {
  const written = files.filter((file) => resultOf(file)?.ok);
  const left = new Set(written.flatMap((file) => file.deferred));
  return {
    written,
    keys: Object.keys(schema.variables).filter((key) => left.has(key)),
  };
}

/**
 * The report line for keys left for a person to set: one `set` command per
 * file of the run that takes them, with `--file` so it works with several.
 */
function deferredLine(files: readonly RunFile[], keys: readonly string[]) {
  const commands = files
    .filter((file) => file.deferred.length)
    .map(
      (file) =>
        `configure-env set --file ${file.path} ${file.deferred.map((key) => `--prompt ${key}`).join(' ')}`,
    );
  return `deferred: ${keys.join(', ')} (set ${keys.length > 1 ? 'them' : 'it'} with ${commands.join(', and ')})`;
}

const replacedLines = (replaced: readonly Replaced[]) =>
  replaced.map(({ file, key }) => `${file}: replaced protected ${key}`);

/** Whether the run writes or chmods the file. */
const changes = (file: PlannedFile) =>
  file.action === 'create' ||
  file.action === 'update' ||
  file.action === 'mode';

/** A file whose mode apply does not loosen, as an error for --json. */
const loosenedErrors = (files: readonly RunFile[]): PlanError[] =>
  files
    .filter((file) => file.reason === 'loosens')
    .map((file) => ({ kind: 'file', path: file.path, message: file.error! }));

/**
 * Prints why an unattended plan writes nothing: its errors (exit 1), else
 * its protected refusals (exit 2). Undefined when it can be applied.
 */
function unattendedRefusal(
  io: Io,
  run: ProjectRun,
  plan: ApiPlan,
  files: readonly RunFile[],
): number | undefined {
  const errors = plan.errors as PlanError[];
  if (errors.length) {
    if (run.json) io.stdout(failureJson(errors, files));
    else {
      errors.forEach((error) =>
        io.stderr(`configure-env: ${describeError(error)}`),
      );
      files
        .filter((file) => file.reason === 'refused')
        .forEach((file) => io.stdout(`${file.path}: ${applyStatus(file)}`));
    }
    return 1;
  }
  // A protected value never changes without --replace-protected: a refusal
  // writes nothing.
  const refused = refusalsOf(plan);
  if (refused.length) {
    if (run.json) io.stdout(failureJson(refused, files));
    else
      refused.forEach((problem) =>
        io.stderr(`configure-env: ${protectedLine(problem)}`),
      );
    return 2;
  }
  return undefined;
}

async function applyUnattended(
  io: Io,
  run: ProjectRun,
  connection: Connection,
  inputs: Inputs,
): Promise<number> {
  const { schema, json } = run;
  const first = await planOf(run, connection, {
    ...(run.files ? { files: run.files } : {}),
    prune: inputs.prune,
  });
  const body = runRequest(
    run,
    inputs,
    valuesFor(schema, first.files, inputs, io.env),
  );
  const plan = await planOf(run, connection, body);
  const files = plan.files.map(runFile(schema));
  const refused = unattendedRefusal(io, run, plan, files);
  if (refused !== undefined) return refused;

  const written = await applyShown(io, run, connection, body, plan);
  if (!written.ok) {
    if (written.kind === 'plan') {
      const again = written.plan.files.map(runFile(schema));
      return unattendedRefusal(io, run, written.plan, again) ?? 1;
    }
    // Refused in the state's transaction, or no transaction: nothing was written.
    const { error } = written;
    if (!error.errors) throw error;
    if (json) io.stdout(failureJson(error.errors, files));
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
  const { files: results, replaced, stateError } = written.applied;
  const warnings = without(written.applied.warnings, stateError?.lines ?? []);
  // A file left with a looser mode than the schema's still drifts.
  const loosened = loosenedErrors(files);
  const ok =
    results.every((result) => result.ok) && !stateError && !loosened.length;
  const resultOf = (file: RunFile) => results[files.indexOf(file)];
  const left = writtenEmpty(schema, files, resultOf);
  const done = replaced.filter((entry) =>
    files.some((file, i) => file.path === entry.file && results[i]?.ok),
  );
  if (json)
    io.stdout(
      JSON.stringify({
        command: 'apply',
        ok,
        errors: [
          ...loosened,
          ...(stateError
            ? [
                {
                  kind: 'file',
                  path: shownPath(io, run, stateError.path),
                  message: stateError.lines.join('; '),
                },
              ]
            : []),
        ],
        files: files.map((file, i) => applyJson(file, results[i])),
        deferred: left.keys,
        ...(done.length ? { replaced: done } : {}),
        ...(warnings.length ? { warnings } : {}),
      }),
    );
  else {
    files.forEach((file, i) =>
      io.stdout(`${file.path}: ${applyStatus(file, results[i])}`),
    );
    replacedLines(done).forEach((line) => io.stdout(line));
    if (left.keys.length) io.stdout(deferredLine(left.written, left.keys));
    stateError?.lines.forEach((line, i) =>
      io.stderr(i ? line : `configure-env: ${line}`),
    );
    warnings.forEach((line) => io.stderr(`configure-env: warning: ${line}`));
  }
  return ok ? 0 : 1;
}

const CANCELLED = 130;

function cancelled(prompts: Prompts): number {
  prompts.cancel('Cancelled; nothing was written.');
  return CANCELLED;
}

/** Closes the prompts with the error that ends the run. */
function closeWith(prompts: Prompts, error: unknown): number {
  if (!(error instanceof CliError)) throw error;
  prompts.log.error(error.lines.join('\n'));
  prompts.outro('Nothing was written.');
  return error.code;
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

/**
 * One plan line per file, with the values it takes, masked: given here, or
 * generated on the server, which answers them masked.
 */
function previewLines(
  schema: EnvSchema,
  files: readonly RunFile[],
  answers: Readonly<Record<string, string>>,
  generated: Readonly<Record<string, string>>,
): string[] {
  return files.map((file) => {
    const shown = neededKeysOf(schema, file)
      .filter(
        (key) => answers[key] !== undefined || generated[key] !== undefined,
      )
      .map((key) => {
        const spec = schema.variables[key]!;
        return `${key}=${generated[key] ?? maskValue(spec, answers[key]!)}`;
      });
    const values = shown.length ? ` (${shown.join(', ')})` : '';
    return `${file.path}: ${planStatus(file)}${values}`;
  });
}

async function applyInteractive(
  io: Io,
  run: ProjectRun,
  connection: Connection,
  inputs: Inputs,
): Promise<number> {
  const { schema, prompts } = run;
  const { sets, generated, deferred } = inputs;
  const first = await planOf(run, connection, {
    ...(run.files ? { files: run.files } : {}),
    prune: inputs.prune,
  });
  prompts.intro(`configure-env · ${run.title}`);
  const files = first.files.map(runFile(schema));
  const picked = await prompts.multiselect<string>({
    message: 'Which files should be written?',
    options: files.map((file) => ({
      value: file.path,
      label: file.path,
      hint: `${file.policy}; ${fileState(file)}`,
    })),
    initialValues: files.filter(changes).map((file) => file.path),
    required: true,
  });
  if (prompts.isCancel(picked)) return cancelled(prompts);
  // The picked files a run can plan: a refused or loosening one is left out.
  const planned = first.files
    .filter(
      (file) =>
        picked.includes(file.path) &&
        file.reason !== 'refused' &&
        file.reason !== 'loosens',
    )
    .map((file) => file.path);
  try {
    checkGenerated(schema, picked, generated);
    // The generated values' problems, before any prompt.
    if (generated.length && planned.length)
      await planOf(run, connection, {
        values: valuesFor(
          schema,
          first.files.filter((file) => planned.includes(file.path)),
          inputs,
          io.env,
        ),
        files: planned,
        prune: inputs.prune,
        generate: generated,
      });
  } catch (error) {
    // The prompts are open: close them with the error, not a bare exit.
    return closeWith(prompts, error);
  }

  let refused = false;
  const selected: RunFile[] = [];
  for (const file of files) {
    if (!picked.includes(file.path)) continue;
    if (file.reason === 'refused') {
      prompts.log.warn(`${file.path}: refused: ${file.error}`);
      refused = true;
    } else if (file.reason === 'loosens') {
      prompts.log.warn(`${file.path}: ${file.error}`);
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
  const answers: Record<string, string> = {};
  for (const [group, keys] of byGroup(schema, needed)) {
    if (group) prompts.log.step(group);
    for (const key of keys) {
      // A --set or generated value is the answer already.
      if (sets[key] !== undefined || generated.includes(key)) continue;
      // A deferred key is never asked: it resolves as in an unattended run,
      // to its environment variable, else its default, else empty.
      if (deferred.includes(key)) {
        const value = givenValue(key, {}, io.env);
        if (value !== undefined) answers[key] = value;
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

  const values = { ...sets, ...answers };
  // The picked create-only files that exist stay in the plan, as an
  // unattended run keeps them, so a --generate value they hold is used.
  const body = runRequest(run, inputs, values, planned);
  let plan: ApiPlan;
  try {
    plan = await planOf(run, connection, body);
  } catch (error) {
    return closeWith(prompts, error);
  }
  const all = plan.files.map(runFile(schema));
  const shown = all.filter((file) =>
    selected.some((entry) => entry.path === file.path),
  );
  const planErrors = plan.errors as PlanError[];
  if (planErrors.length) {
    prompts.log.error(planErrors.map(describeError).join('\n'));
    prompts.outro('Nothing was written.');
    return 1;
  }
  const blocked = refusalsOf(plan);
  if (blocked.length) {
    prompts.log.error(blocked.map(protectedLine).join('\n'));
    prompts.outro('Nothing was written.');
    return 2;
  }
  prompts.note(
    previewLines(schema, shown, values, plan.generated ?? {}).join('\n'),
    'Plan',
  );
  if (!shown.some(changes)) {
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
    const keys = [...new Set((plan.replaced ?? []).map((entry) => entry.key))];
    if (!(await confirmReplacements({ io, ...run }, keys)))
      return cancelled(prompts);
  } catch (error) {
    return closeWith(prompts, error);
  }

  const progress = prompts.spinner();
  progress.start('Writing');
  const written = await applyShown(io, run, connection, body, plan).catch(
    (error: unknown) => ({ ok: false as const, kind: 'error' as const, error }),
  );
  if (!written.ok) {
    progress.error('Not written');
    if (written.kind === 'plan') {
      const again = written.plan;
      const errors = again.errors as PlanError[];
      prompts.log.error(
        (errors.length
          ? errors.map(describeError)
          : refusalsOf(again).map(protectedLine)
        ).join('\n'),
      );
      prompts.outro('Nothing was written.');
      return errors.length ? 1 : 2;
    }
    return closeWith(prompts, written.error);
  }
  const { files: results, stateError } = written.applied;
  const resultOf = (file: RunFile) => results[all.indexOf(file)];
  const left = writtenEmpty(schema, shown, resultOf);
  const deferredLines = left.keys.length
    ? [deferredLine(left.written, left.keys)]
    : [];
  const done = written.applied.replaced.filter((entry) =>
    shown.some((file) => file.path === entry.file && resultOf(file)?.ok),
  );
  if (stateError) prompts.log.error(stateError.lines.join('\n'));
  without(written.applied.warnings, stateError?.lines ?? []).forEach((line) =>
    prompts.log.warn(line),
  );
  const failed = shown
    .map(resultOf)
    .filter((result): result is ApplyResult => Boolean(result && !result.ok));
  if (failed.length) {
    progress.error(`${failed.length} of ${shown.length} files failed`);
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
      ...shown.map(
        (file) => `${file.path}: ${applyStatus(file, resultOf(file))}`,
      ),
      ...replacedLines(done),
      ...deferredLines,
    ].join('\n'),
  );
  return stateError ? 1 : failure;
}
