// `configure-env set`, `get` and `unset`: edit one file's variables in
// place, keeping every other byte, or print one.

import {
  getValue,
  removeEntry,
  setValue,
  appendLines,
  serialize,
} from '../engine/dotenv.ts';
import { fileRules } from '../engine/check.ts';
import { commentLines, entryComment } from '../engine/plan.ts';
import {
  VARIABLE_NAME,
  isTemplate,
  type EnvSchema,
  type FileSpec,
  type VariableSpec,
} from '../schema/definition.ts';
import {
  formatValue,
  maskValue,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '../schema/values.ts';
import { ask } from './apply.ts';
import {
  CliError,
  NO_TERMINAL,
  contextOf,
  givenTwice,
  loadContextSchema,
  parseCommandArgs,
  usageError,
} from './common.ts';
import { checkConflict, generateKeys, generateValue } from './generate.ts';
import { GET_HELP, SET_HELP, UNSET_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  type EnvFile,
  UNKNOWN_SPEC,
  chooseFile,
  jsonValue,
  readEnvFile,
  variablesOf,
  writeEnvFile,
} from './target.ts';

const CANCELLED = 130;

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
} as const;

type SetStatus = 'updated' | 'added' | 'unchanged';

/** `KEY=VALUE` pairs in order; a later pair for a key replaces an earlier one. */
function parsePairs(positionals: readonly string[]): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const pair of positionals) {
    const at = pair.indexOf('=');
    if (at < 1) throw usageError(`set takes KEY=VALUE, got ${pair}`);
    const key = pair.slice(0, at);
    checkName(key);
    pairs.delete(key);
    pairs.set(key, pair.slice(at + 1));
  }
  return pairs;
}

/** The comment lines above a new key, as the engine writes them. */
function newEntryLines(
  schema: EnvSchema,
  file: FileSpec,
  key: string,
  written: string,
): string[] {
  const comment = variablesOf(schema, file).has(key)
    ? entryComment(schema, file, key)
    : undefined;
  return [...(comment ? commentLines(comment) : []), `${key}=${written}`];
}

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

/** Appends a key: after a blank line when it has a comment and follows lines. */
function appendKey(file: EnvFile, lines: string[]) {
  const separate = lines.length > 1 && file.doc.lines.length > 0;
  appendLines(file.doc, separate ? ['', ...lines] : lines);
}

export async function setCommand(args: string[], io: Io): Promise<number> {
  const { values: options, positionals } = parseCommandArgs(args, SET_OPTIONS);
  if (options.help) {
    io.stdout(SET_HELP);
    return 0;
  }
  const pairs = parsePairs(positionals);
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
    if (context.prompts.isCancel(answer)) {
      context.prompts.cancel('Cancelled; nothing was written.');
      return CANCELLED;
    }
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

  // Validate everything before touching the file: one bad value writes nothing.
  const written = new Map<
    string,
    { spec: VariableSpec; text: string; plain: string }
  >();
  const errors: string[] = [];
  for (const [key, raw] of pairs) {
    const variable = specFor(schema, spec, key);
    if (variable && kept.has(key)) {
      // A kept value is checked like any other, and never shown: it may be
      // the secret the file already holds.
      const result = validateValue(variable, raw);
      if (!result.ok) {
        errors.push(`${key}: ${result.error}; unset it to generate a new one`);
        continue;
      }
      // `raw` is the value the file holds: equal to it, the entry reports
      // unchanged and its line is never rewritten, so no formatting applies.
      written.set(key, { spec: variable, text: raw, plain: raw });
      continue;
    }
    if (!variable) {
      const text = formatValue(UNKNOWN_SPEC, raw);
      written.set(key, { spec: UNKNOWN_SPEC, text, plain: raw });
      continue;
    }
    const result = validateValue(variable, raw);
    if (!result.ok) {
      errors.push(`${key}: ${result.error}`);
      continue;
    }
    const text = formatValue(variable, result.value);
    written.set(key, { spec: variable, text, plain: unquoteValue(text) });
  }
  if (errors.length)
    throw new CliError(1, [...errors, `nothing was written to ${spec.path}`]);

  if (!file.exists && spec.header)
    appendLines(file.doc, [...commentLines(spec.header), '']);
  const report: {
    key: string;
    status: SetStatus;
    spec: VariableSpec;
    plain: string;
  }[] = [];
  for (const [key, { spec: variable, text, plain }] of written) {
    const current = getValue(file.doc, key);
    let status: SetStatus;
    if (current === undefined) {
      appendKey(file, newEntryLines(schema, spec, key, text));
      status = 'added';
    } else if (current === plain) status = 'unchanged';
    else {
      setValue(file.doc, key, text);
      status = 'updated';
    }
    // A piped value is masked even for a key not marked secret: it came
    // from a secret manager, and the output may land in an agent's log.
    const shown = key === stdinKey ? { ...variable, secret: true } : variable;
    report.push({ key, status, spec: shown, plain });
  }
  // The rules between variables, over the values the file would hold: one
  // that names a key this run sets and breaks writes nothing.
  const broken = fileRules(schema, spec, file.doc).filter((problem) =>
    [problem.key, ...problem.others].some((key) => written.has(key)),
  );
  if (broken.length)
    throw new CliError(1, [
      ...broken.map(
        (problem) => `${ruleKeys(problem).join(', ')}: ${problem.message}`,
      ),
      `nothing was written to ${spec.path}`,
    ]);
  if (report.some((entry) => entry.status !== 'unchanged'))
    await writeEnvFile(file, serialize(file.doc));

  if (context.json)
    io.stdout(
      JSON.stringify({
        command: 'set',
        ok: true,
        file: spec.path,
        keys: report.map(({ key, status, spec: variable, plain }) => ({
          key,
          status,
          ...jsonValue(variable, plain),
        })),
      }),
    );
  else
    report.forEach(({ key, status, spec: variable, plain }) =>
      io.stdout(`${key}: ${status} (${maskValue(variable, plain)})`),
    );
  return 0;
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

const UNSET_OPTIONS = { 'allow-template': { type: 'boolean' } } as const;

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
  const file = await readEnvFile(context, spec);
  const report: { key: string; status: 'removed' | 'absent' }[] = [];
  for (const key of new Set(positionals)) {
    const known = specFor(schema, spec, key) !== undefined;
    const comment = known ? entryComment(schema, spec, key) : undefined;
    const removed = removeEntry(
      file.doc,
      key,
      comment ? commentLines(comment) : [],
    );
    report.push({ key, status: removed ? 'removed' : 'absent' });
  }
  if (report.some((entry) => entry.status === 'removed'))
    await writeEnvFile(file, serialize(file.doc));

  if (context.json)
    io.stdout(
      JSON.stringify({
        command: 'unset',
        ok: true,
        file: spec.path,
        keys: report,
      }),
    );
  else report.forEach(({ key, status }) => io.stdout(`${key}: ${status}`));
  return 0;
}
