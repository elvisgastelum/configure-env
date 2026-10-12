// `configure-env set`, `get` and `unset`: edit one file's variables in
// place, keeping every other byte, or print one.

import {
  type EditContext,
  type EditFailure,
  type EnvFile,
  type EnvSchema,
  type FileSpec,
  type RunState,
  VARIABLE_NAME,
  getValue,
  isTemplate,
  maskValue,
  parsePairs,
  setValues,
  unsetValues,
} from '@configure-env/core';
import { ask } from './apply.ts';
import {
  CliError,
  type Context,
  NO_TERMINAL,
  contextOf,
  displayPath,
  givenTwice,
  loadContextSchema,
  parseCommandArgs,
  usageError,
} from './common.ts';
import { checkConflict, generateKeys, generateValue } from './generate.ts';
import { GET_HELP, SET_HELP, UNSET_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  confirmReplacements,
  loadRunState,
  protectedError,
  replaceKeys,
  stateError,
} from './protect.ts';
import {
  UNKNOWN_SPEC,
  chooseFile,
  jsonValue,
  readEnvFile,
  variablesOf,
} from './target.ts';

const CANCELLED = 130;

function cancelled(context: { prompts: { cancel(message?: string): void } }) {
  context.prompts.cancel('Cancelled; nothing was written.');
  return CANCELLED;
}

/** The core's view of a run: the schema, the state it read, and its io. */
const editContext = (
  context: Context,
  schema: EnvSchema,
  run: RunState | undefined,
): EditContext => ({
  schema,
  run,
  cwd: context.io.cwd,
  writeState: context.io.writeState,
});

/**
 * Asks a person to confirm the replacements; unattended (--ci or --json)
 * there is no question, and every --replace-protected key may be replaced.
 */
const confirmOf = (context: Context) =>
  context.ci || context.json
    ? undefined
    : (keys: string[]) => confirmReplacements(context, keys);

/**
 * An edit that wrote nothing, as the CLI reports it: a cancel exits 130, a
 * protected refusal 2, anything else 1. A state it could not get or use is
 * printed as the command's document with --json.
 */
function failed(
  context: Context,
  command: string,
  file: string,
  failure: EditFailure,
): number {
  const hint = `nothing was written to ${file}`;
  switch (failure.kind) {
    case 'cancelled':
      return cancelled(context);
    case 'invalid':
      throw new CliError(1, [...failure.messages, hint]);
    case 'protected':
      throw protectedError(failure.problems, hint);
    case 'write':
      throw new CliError(1, [failure.message]);
    case 'state': {
      const error = stateError(failure.path, failure.lines);
      if (!context.json) throw error;
      context.io.stdout(
        JSON.stringify({
          command,
          ok: false,
          file,
          keys: [],
          errors: error.errors,
        }),
      );
      return error.code;
    }
  }
}

/**
 * The end of a set or unset run: with --json, its document, `ok` false and
 * the state failure as a `file` error when the state was not written (exit
 * 1); else the lines, or the state failure (exit 1).
 */
function finish(
  context: Context,
  document: { command: string; file: string; keys: unknown[] },
  lines: string[],
  stateError: string[] | undefined,
): number {
  const { io } = context;
  if (context.json) {
    io.stdout(
      JSON.stringify(
        stateError
          ? {
              ...document,
              ok: false,
              errors: [
                {
                  kind: 'file',
                  path: displayPath(io.cwd, context.statePath),
                  message: stateError.join('; '),
                },
              ],
            }
          : {
              command: document.command,
              ok: true,
              file: document.file,
              keys: document.keys,
            },
      ),
    );
    return stateError ? 1 : 0;
  }
  if (stateError) throw new CliError(1, stateError);
  lines.forEach((line) => io.stdout(line));
  return 0;
}

/** The report line of each replaced key. */
const replacedLines = (replaced: ReadonlySet<string>) =>
  [...replaced].map((key) => `replaced protected ${key}`);

/** The context, schema and file every edit command starts from. */
async function start(
  io: Io,
  values: Parameters<typeof contextOf>[1],
  guard: { guard?: boolean; allowTemplate?: boolean },
) {
  const context = await contextOf(io, values);
  const schema = await loadContextSchema(context);
  const spec = chooseFile(schema, context.files, guard);
  return { context, schema, spec };
}

/** A key's spec for this file, or undefined when it is not one of its variables. */
const specFor = (schema: EnvSchema, file: FileSpec, key: string) =>
  variablesOf(schema, file).has(key) ? schema.variables[key] : undefined;

function checkName(key: string) {
  if (!VARIABLE_NAME.test(key))
    throw usageError(`${key}: is not a valid variable name`);
}

// ---------------------------------------------------------------- set

const SET_OPTIONS = {
  prompt: { type: 'string', multiple: true },
  generate: { type: 'string', multiple: true },
  // Repeatable only so a second one is refused, not silently kept.
  stdin: { type: 'string', multiple: true },
  create: { type: 'boolean' },
  'allow-unknown': { type: 'boolean' },
  'allow-template': { type: 'boolean' },
  'replace-protected': { type: 'string', multiple: true },
} as const;

/**
 * What the stdin reader returns. A failure of its own (EIO, say) exits 1
 * with its reason, which never holds the input.
 */
async function readStdinOrFail(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(1, [
      `--stdin could not be read: ${(error as Error).message}`,
    ]);
  }
}

/** Exits 1 for a missing file, unless `create` lets set create it. */
function checkExists(file: EnvFile, create: boolean) {
  if (!file.exists && !create)
    throw new CliError(1, [
      `${file.spec.path}: does not exist; pass --create to create it`,
    ]);
}

export async function setCommand(args: string[], io: Io): Promise<number> {
  const { values: options, positionals } = parseCommandArgs(args, SET_OPTIONS);
  if (options.help) {
    io.stdout(SET_HELP);
    return 0;
  }
  const parsed = parsePairs(positionals);
  if (!parsed.ok) throw usageError(parsed.message);
  const { pairs } = parsed;
  const promptKeys = (options.prompt ?? []).filter((key) => !pairs.has(key));
  promptKeys.forEach(checkName);
  if ((options.stdin?.length ?? 0) > 1)
    throw usageError('--stdin takes one key; stdin holds one value');
  const stdinKey = options.stdin?.[0];
  if (stdinKey !== undefined) checkName(stdinKey);
  if (stdinKey !== undefined && options.prompt?.length)
    throw usageError('--stdin and --prompt cannot be used together');
  for (const key of options.generate ?? []) {
    checkName(key);
    if (pairs.has(key) || options.prompt?.includes(key) || key === stdinKey)
      throw givenTwice('--generate', key);
  }
  if (stdinKey !== undefined && pairs.has(stdinKey))
    throw givenTwice('--stdin', stdinKey);
  if (
    !pairs.size &&
    !promptKeys.length &&
    !options.generate?.length &&
    stdinKey === undefined
  )
    throw usageError(
      'set takes KEY=VALUE pairs, --prompt KEY, --generate KEY or --stdin KEY',
    );
  const { context, schema, spec } = await start(io, options, {
    guard: true,
    allowTemplate: Boolean(options['allow-template']),
  });
  // A template is committed: a secret meant for it is a mistake, allowed or not.
  if ((options.generate?.length || stdinKey !== undefined) && isTemplate(spec))
    throw usageError(
      `--generate and --stdin never write to a template such as ${spec.path}`,
    );
  if (promptKeys.length && (context.ci || context.json || !io.isTTY))
    throw usageError(`--prompt needs a terminal; ${NO_TERMINAL}`);
  if (stdinKey !== undefined && !io.readStdin)
    throw usageError('--stdin needs readStdin in the io passed to main()');
  if (stdinKey !== undefined && io.stdinIsTTY)
    throw usageError(
      '--stdin reads the value from a pipe; stdin is a terminal',
    );
  const generated = generateKeys(
    options.generate,
    (key) => specFor(schema, spec, key),
    schema,
  );
  const replace = replaceKeys(schema, options['replace-protected']);
  const run = await loadRunState(context, schema);

  const allowUnknown = Boolean(options['allow-unknown']);
  const unknown = [
    ...pairs.keys(),
    ...promptKeys,
    ...(stdinKey === undefined ? [] : [stdinKey]),
  ].filter((key) => !specFor(schema, spec, key));
  if (unknown.length && !allowUnknown)
    throw new CliError(
      1,
      unknown.map(
        (key) =>
          `${key}: is not a variable of ${spec.path}; pass --allow-unknown to set it anyway`,
      ),
    );

  // A missing file fails before any prompt or wait.
  const peek = await readEnvFile(context, spec);
  checkExists(peek, Boolean(options.create));

  // Every wait (prompts, stdin) comes before the file is read for the
  // edit: a change made meanwhile, as by a parallel set, is kept, and the
  // write's check that the file is unchanged since it was read rarely fails.
  for (const key of promptKeys) {
    const variable = specFor(schema, spec, key) ?? UNKNOWN_SPEC;
    const current = getValue(peek.doc, key);
    const initial =
      current ??
      (variable.default === undefined ? '' : String(variable.default));
    const answer = await ask(
      context.prompts,
      key,
      variable,
      variable.secret ? '' : initial,
    );
    if (context.prompts.isCancel(answer)) return cancelled(context);
    pairs.set(key, answer);
  }
  if (stdinKey !== undefined) {
    const value = (await readStdinOrFail(io.readStdin!)).replace(/\r?\n$/, '');
    // An empty pipe is almost always a failed command upstream, whose exit
    // status the shell drops: never write it, even for an optional key.
    if (!value)
      throw new CliError(1, [
        `${stdinKey}: stdin was empty; nothing was written to ${spec.path}`,
      ]);
    pairs.set(stdinKey, value);
  }

  const waited = promptKeys.length > 0 || stdinKey !== undefined;
  const file = waited ? await readEnvFile(context, spec) : peek;
  // Checked again: the file can be deleted during a prompt or a stdin wait.
  checkExists(file, Boolean(options.create));

  // A generated value never replaces one that is set: no rotation by accident.
  const kept = new Set<string>();
  for (const key of generated) {
    const current = getValue(file.doc, key);
    if (current) {
      kept.add(key);
      pairs.set(key, current);
      continue;
    }
    // As apply does: a partner the file would hold refuses it before any
    // value is made.
    checkConflict(schema, spec, key, (other) =>
      Boolean(
        pairs.has(other) || generated.includes(other)
          ? (pairs.get(other) ?? true)
          : getValue(file.doc, other),
      ),
    );
    pairs.set(key, generateValue(key, specFor(schema, spec, key)!));
  }

  const result = await setValues(
    editContext(context, schema, run),
    file,
    pairs,
    { replace, kept, confirm: confirmOf(context) },
  );
  if (!result.ok) return failed(context, 'set', spec.path, result);
  const replaced = new Set(result.replaced);
  // A piped value is masked even for a key not marked secret: it came
  // from a secret manager, and the output may land in an agent's log.
  const report = result.keys.map((entry) =>
    entry.key === stdinKey
      ? { ...entry, spec: { ...entry.spec, secret: true } }
      : entry,
  );

  return finish(
    context,
    {
      command: 'set',
      file: spec.path,
      keys: report.map(({ key, status, spec: variable, plain }) => ({
        key,
        status,
        ...jsonValue(variable, plain),
        ...(replaced.has(key) ? { replaced: true } : {}),
      })),
    },
    [
      ...report.map(
        ({ key, status, spec: variable, plain }) =>
          `${key}: ${status} (${maskValue(variable, plain)})`,
      ),
      ...replacedLines(replaced),
    ],
    result.stateError,
  );
}

// ---------------------------------------------------------------- get

const GET_OPTIONS = { reveal: { type: 'boolean' } } as const;

export async function getCommand(args: string[], io: Io): Promise<number> {
  const { values: options, positionals } = parseCommandArgs(args, GET_OPTIONS);
  if (options.help) {
    io.stdout(GET_HELP);
    return 0;
  }
  if (positionals.length !== 1) throw usageError('get takes one KEY');
  const key = positionals[0]!;
  checkName(key);
  const { context, schema, spec } = await start(io, options, {});
  const file = await readEnvFile(context, spec);
  if (!file.exists) throw new CliError(1, [`${spec.path}: does not exist`]);
  const variable = specFor(schema, spec, key) ?? UNKNOWN_SPEC;
  const value = getValue(file.doc, key);
  const reveal = Boolean(options.reveal) || !variable.secret;

  if (context.json) {
    io.stdout(
      JSON.stringify(
        value === undefined
          ? { key, set: false }
          : {
              key,
              ...(reveal ? { value } : jsonValue(variable, value)),
              set: true,
            },
      ),
    );
    return value === undefined ? 1 : 0;
  }
  if (value === undefined)
    throw new CliError(1, [`${key}: is not set in ${spec.path}`]);
  if (!reveal)
    throw new CliError(1, [
      `${key}: is secret (${maskValue(variable, value)})`,
      'pass --reveal to print it',
    ]);
  io.stdout(value);
  return 0;
}

// ---------------------------------------------------------------- unset

const UNSET_OPTIONS = {
  'allow-template': { type: 'boolean' },
  'replace-protected': { type: 'string', multiple: true },
} as const;

export async function unsetCommand(args: string[], io: Io): Promise<number> {
  const { values: options, positionals } = parseCommandArgs(
    args,
    UNSET_OPTIONS,
  );
  if (options.help) {
    io.stdout(UNSET_HELP);
    return 0;
  }
  if (!positionals.length) throw usageError('unset takes one or more KEYs');
  positionals.forEach(checkName);
  const { context, schema, spec } = await start(io, options, {
    guard: true,
    allowTemplate: Boolean(options['allow-template']),
  });
  const replace = replaceKeys(schema, options['replace-protected']);
  const run = await loadRunState(context, schema);
  const file = await readEnvFile(context, spec);
  const result = await unsetValues(
    editContext(context, schema, run),
    file,
    positionals,
    { replace, confirm: confirmOf(context) },
  );
  if (!result.ok) return failed(context, 'unset', spec.path, result);
  const replaced = new Set(result.replaced);

  return finish(
    context,
    {
      command: 'unset',
      file: spec.path,
      keys: result.keys.map((entry) =>
        replaced.has(entry.key) ? { ...entry, replaced: true } : entry,
      ),
    },
    [
      ...result.keys.map(({ key, status }) => `${key}: ${status}`),
      ...replacedLines(replaced),
    ],
    result.stateError,
  );
}
