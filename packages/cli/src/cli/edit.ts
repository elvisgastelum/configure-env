// `configure-env set`, `get` and `unset`: edit one file's variables in
// place, keeping every other byte, or print one. They run through the
// configure-env API (connect.ts): GET /api/variables reads the file, POST
// /api/reveal a secret shown unmasked, POST /api/values/set and
// /api/values/unset write it, and the server records the history as the
// cli's.

import {
  type EditProblem,
  type ValuesEdit,
  revealValue,
  setValues,
  unsetValues,
} from '@configure-env/api-client/client';
import {
  type EnvSchema,
  type FileSpec,
  VARIABLE_NAME,
  isTemplate,
  parsePairs,
} from '@configure-env/core';
import { ask } from './apply.ts';
import {
  CliError,
  NO_TERMINAL,
  displayPath,
  givenTwice,
  keyError,
  parseCommandArgs,
  printWarnings,
  usageError,
} from './common.ts';
import {
  type Connection,
  type ProjectRun,
  answerMessage,
  answerOf,
  openProject,
  send,
} from './connect.ts';
import { checkConflict, generateKeys } from './generate.ts';
import { GET_HELP, SET_HELP, UNSET_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  type ProtectedProblem,
  confirmReplacements,
  protectedError,
  replaceKeys,
  stateError,
} from './protect.ts';
import {
  type ListedFile,
  UNKNOWN_SPEC,
  chooseFile,
  listFiles,
  listedFile,
  listedKey,
  variablesOf,
} from './target.ts';

const CANCELLED = 130;

function cancelled(run: { prompts: { cancel(message?: string): void } }) {
  run.prompts.cancel('Cancelled; nothing was written.');
  return CANCELLED;
}

/**
 * Whether a person confirms the replacements; unattended (--ci or --json)
 * there is no question, and every --replace-protected key may be replaced.
 */
const confirms = (run: ProjectRun) => !run.ci && !run.json;

/** The schema's file as the server reads it now. */
async function readFile(
  run: ProjectRun,
  connection: Connection,
  spec: FileSpec,
): Promise<ListedFile> {
  return listedFile(await listFiles(run, connection), spec);
}

/** What a write answered when it wrote nothing. */
type Refusal = { status: number; data: unknown };

/** The message a generated value failed with, as the CLI words it. */
function generateError({ key, message }: EditProblem & { key: string }) {
  if (/ is too short for a generated secret$/.test(message))
    return keyError(
      'usage',
      key,
      `${message}; set it with --prompt or --stdin`,
    );
  if (message === 'cannot generate a value that passes its rules')
    return keyError(
      'value',
      key,
      `${message}; set it with --prompt or --stdin`,
    );
  return new CliError(1, [`${key}: ${message}`]);
}

const protectedProblems = (errors: readonly EditProblem[]) =>
  errors.map(({ key = '', message, reason }): ProtectedProblem => ({
    kind: 'protected',
    key,
    message,
    ...(reason ? { reason } : {}),
  }));

/**
 * A write that wrote nothing, as the CLI reports it: values that break
 * their rules exit 1, a protected refusal 2, a state the server could not
 * get or use 1 (printed as the command's document with --json), anything
 * else 1 with the server's message.
 */
function refused(
  io: Io,
  run: ProjectRun,
  command: string,
  file: string,
  response: Refusal,
): number {
  const hint = `nothing was written to ${file}`;
  const data = (response.data ?? {}) as {
    kind?: string;
    errors?: EditProblem[];
    path?: string;
    lines?: string[];
    message?: string;
  };
  if (response.status === 422 && data.kind === 'protected')
    throw protectedError(protectedProblems(data.errors ?? []), hint);
  if (response.status === 422 && data.kind === 'invalid') {
    const errors = data.errors ?? [];
    const keyed = errors.find((error) => error.key !== undefined);
    if (keyed) throw generateError(keyed as EditProblem & { key: string });
    throw new CliError(1, [...errors.map((error) => error.message), hint]);
  }
  if (response.status === 503 && data.lines && data.path !== undefined) {
    const error = stateError(data.path, data.lines);
    if (!run.json) throw error;
    io.stdout(
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
  if (response.status === 503)
    throw new CliError(1, [
      answerMessage(response),
      'fix or restore it; nothing was written',
    ]);
  return answerOf<never>(run, response);
}

/**
 * Sends a write, confirming its replacements first when a person runs it:
 * sent without them, a refusal of only --replace-protected keys asks for
 * those, then it is sent again replacing them. Resolves to the answer, or
 * to the exit code of a write that wrote nothing.
 */
async function write(
  io: Io,
  run: ProjectRun,
  connection: Connection,
  command: string,
  file: string,
  replace: ReadonlySet<string>,
  request: (
    replaceProtected: string[],
  ) => Promise<{ status: number; data: unknown }>,
): Promise<ValuesEdit | number> {
  const sent = (keys: string[]) => send(connection, () => request(keys));
  let response = await sent(confirms(run) ? [] : [...replace]);
  if (confirms(run) && replace.size && response.status === 422) {
    const data = response.data as { kind?: string; errors?: EditProblem[] };
    const problems = data.kind === 'protected' ? (data.errors ?? []) : [];
    const keys = problems.map((problem) => problem.key ?? '');
    const refusals = problems.filter(({ key = '' }) => !replace.has(key));
    if (refusals.length)
      throw protectedError(
        protectedProblems(refusals),
        `nothing was written to ${file}`,
      );
    if (problems.length) {
      if (!(await confirmReplacements({ io, ...run }, keys)))
        return cancelled(run);
      response = await sent(keys);
    }
  }
  if (response.status !== 200) return refused(io, run, command, file, response);
  return response.data as ValuesEdit;
}

/**
 * The end of a set or unset run: with --json, its document, `ok` false and
 * the state failure as a `file` error when the state was not written (exit
 * 1); else the lines, or the state failure (exit 1). The other warnings (a
 * history not recorded) go to stderr either way.
 */
function finish(
  io: Io,
  run: ProjectRun,
  document: { command: string; file: string; keys: unknown[] },
  lines: string[],
  edit: ValuesEdit,
): number {
  const failure = edit.stateError;
  const { statePath } = run;
  const shown = (line: string) =>
    statePath
      ? line.replaceAll(statePath, displayPath(io.cwd, statePath))
      : line;
  printWarnings(
    io,
    edit.warnings.filter((line) => !failure?.includes(line)).map(shown),
  );
  if (run.json) {
    io.stdout(
      JSON.stringify(
        failure
          ? {
              ...document,
              ok: false,
              errors: [
                {
                  kind: 'file',
                  // The state, as the failure's first line names it.
                  path: failure[0]?.split(': not written')[0] ?? '',
                  message: failure.join('; '),
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
    return failure ? 1 : 0;
  }
  if (failure) throw new CliError(1, failure);
  lines.forEach((line) => io.stdout(line));
  return 0;
}

/** The report line of each replaced key. */
const replacedLines = (replaced: ReadonlySet<string>) =>
  [...replaced].map((key) => `replaced protected ${key}`);

/** The project and file every edit command starts from. */
async function start(
  io: Io,
  values: Parameters<typeof openProject>[1],
  guard: { guard?: boolean; allowTemplate?: boolean },
) {
  const run = await openProject(io, values);
  const spec = chooseFile(run.schema, run.files, guard);
  return { run, schema: run.schema, spec };
}

/** A key's spec for this file, or undefined when it is not one of its variables. */
const specFor = (schema: EnvSchema, file: FileSpec, key: string) =>
  variablesOf(schema, file).has(key) ? schema.variables[key] : undefined;

function checkName(key: string) {
  if (!VARIABLE_NAME.test(key))
    throw usageError(`${key}: is not a valid variable name`);
}

/** Runs `task` with a connection to the run's server, closed after. */
async function connected<T>(
  run: ProjectRun,
  task: (connection: Connection) => Promise<T>,
): Promise<T> {
  const connection = await run.connect();
  try {
    return await task(connection);
  } finally {
    await connection.close();
  }
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
function checkExists(file: ListedFile, create: boolean) {
  if (!file.exists && !create)
    throw new CliError(1, [
      `${file.path}: does not exist; pass --create to create it`,
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
  const { run, schema, spec } = await start(io, options, {
    guard: true,
    allowTemplate: Boolean(options['allow-template']),
  });
  // A template is committed: a secret meant for it is a mistake, allowed or not.
  if ((options.generate?.length || stdinKey !== undefined) && isTemplate(spec))
    throw usageError(
      `--generate and --stdin never write to a template such as ${spec.path}`,
    );
  if (promptKeys.length && (run.ci || run.json || !io.isTTY))
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

  return connected(run, async (connection) => {
    // A missing file fails before any prompt or wait.
    const peek = await readFile(run, connection, spec);
    checkExists(peek, Boolean(options.create));

    // Every wait (prompts, stdin) comes before the file is read for the
    // edit: a change made meanwhile, as by a parallel set, is kept, and the
    // write's check that the file is unchanged since it was read rarely
    // fails.
    for (const key of promptKeys) {
      const variable = specFor(schema, spec, key) ?? UNKNOWN_SPEC;
      const current = listedKey(peek, key)?.value;
      const initial =
        current ??
        (variable.default === undefined ? '' : String(variable.default));
      const answer = await ask(
        run.prompts,
        key,
        variable,
        variable.secret ? '' : initial,
      );
      if (run.prompts.isCancel(answer)) return cancelled(run);
      pairs.set(key, answer);
    }
    if (stdinKey !== undefined) {
      const value = (await readStdinOrFail(io.readStdin!)).replace(
        /\r?\n$/,
        '',
      );
      // An empty pipe is almost always a failed command upstream, whose exit
      // status the shell drops: never write it, even for an optional key.
      if (!value)
        throw new CliError(1, [
          `${stdinKey}: stdin was empty; nothing was written to ${spec.path}`,
        ]);
      pairs.set(stdinKey, value);
    }

    const waited = promptKeys.length > 0 || stdinKey !== undefined;
    const file = waited ? await readFile(run, connection, spec) : peek;
    // Checked again: the file can be deleted during a prompt or a stdin wait.
    checkExists(file, Boolean(options.create));

    // A generated value never replaces one that is set: no rotation by
    // accident. As apply does, a partner the file would hold refuses it
    // before any value is made.
    for (const key of generated) {
      if (listedKey(file, key)?.set === 'yes') continue;
      checkConflict(schema, spec, key, (other) =>
        pairs.has(other)
          ? Boolean(pairs.get(other))
          : generated.includes(other) || listedKey(file, other)?.set === 'yes',
      );
    }

    const done = await write(
      io,
      run,
      connection,
      'set',
      spec.path,
      replace,
      (replaceProtected) =>
        setValues(
          {
            file: spec.path,
            fingerprint: file.fingerprint ?? null,
            ...(pairs.size ? { values: Object.fromEntries(pairs) } : {}),
            ...(generated.length
              ? { generate: generated, keepExisting: true }
              : {}),
            ...(replaceProtected.length ? { replaceProtected } : {}),
            ...(allowUnknown ? { allowUnknown } : {}),
            // A piped value is masked and never kept in the history, even
            // for a key not marked secret: it came from a secret manager,
            // and the output may land in an agent's log.
            ...(stdinKey === undefined ? {} : { masked: [stdinKey] }),
          },
          connection.init(),
        ),
    );
    if (typeof done === 'number') return done;
    const replaced = new Set(done.replaced);
    const secret = (key: string) =>
      key === stdinKey || Boolean(specFor(schema, spec, key)?.secret);

    return finish(
      io,
      run,
      {
        command: 'set',
        file: spec.path,
        keys: done.keys.map(({ key, status, value = '' }) => ({
          key,
          status,
          ...(secret(key) ? { masked: value } : { value }),
          ...(replaced.has(key) ? { replaced: true } : {}),
        })),
      },
      [
        ...done.keys.map(
          ({ key, status, value = '' }) => `${key}: ${status} (${value})`,
        ),
        ...replacedLines(replaced),
      ],
      done,
    );
  });
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
  const { run, schema, spec } = await start(io, options, {});
  const variable = specFor(schema, spec, key) ?? UNKNOWN_SPEC;
  const reveal = Boolean(options.reveal) || !variable.secret;
  const read = await connected(run, async (connection) => {
    const file = await readFile(run, connection, spec);
    if (!file.exists) throw new CliError(1, [`${spec.path}: does not exist`]);
    // The listing masks a secret: it is revealed only when asked.
    const shown = listedKey(file, key)?.value;
    if (shown === undefined || !reveal || !variable.secret)
      return { shown, value: shown };
    const revealed = await send(connection, () =>
      revealValue({ file: spec.path, key }, connection.init()),
    );
    const value = answerOf<{ value: string | null }>(run, revealed).value;
    return { shown, value: value ?? undefined };
  });
  const { shown, value } = read;

  if (run.json) {
    io.stdout(
      JSON.stringify(
        value === undefined
          ? { key, set: false }
          : { key, ...(reveal ? { value } : { masked: shown }), set: true },
      ),
    );
    return value === undefined ? 1 : 0;
  }
  if (value === undefined)
    throw new CliError(1, [`${key}: is not set in ${spec.path}`]);
  if (!reveal)
    throw new CliError(1, [
      `${key}: is secret (${shown})`,
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
  const { run, schema, spec } = await start(io, options, {
    guard: true,
    allowTemplate: Boolean(options['allow-template']),
  });
  const replace = replaceKeys(schema, options['replace-protected']);
  return connected(run, async (connection) => {
    const file = await readFile(run, connection, spec);
    const done = await write(
      io,
      run,
      connection,
      'unset',
      spec.path,
      replace,
      (replaceProtected) =>
        unsetValues(
          {
            file: spec.path,
            fingerprint: file.fingerprint ?? null,
            keys: positionals,
            ...(replaceProtected.length ? { replaceProtected } : {}),
          },
          connection.init(),
        ),
    );
    if (typeof done === 'number') return done;
    const replaced = new Set(done.replaced);

    return finish(
      io,
      run,
      {
        command: 'unset',
        file: spec.path,
        keys: done.keys.map(({ key, status }) =>
          replaced.has(key) ? { key, status, replaced: true } : { key, status },
        ),
      },
      [
        ...done.keys.map(({ key, status }) => `${key}: ${status}`),
        ...replacedLines(replaced),
      ],
      done,
    );
  });
}
