// `configure-env init`: writes a starting env.schema.json, inferred from an
// example env file when there is one. It runs through the configure-env API
// (connect.ts): POST /api/schema/init writes it, previewed first for the
// person to review the types in a terminal; --force names the fingerprint
// GET /api/schema gives, so the schema there is replaced.

import { posix, relative, resolve, sep } from 'node:path';
import {
  getSchema,
  initSchema,
  type InitSchemaRequest,
  type Schema,
} from '@configure-env/api-client/client';
import {
  DEFAULT_EXAMPLE,
  type IgnoreStatus,
  type InferredVariable,
  STATE_IGNORE,
  type SchemaError,
  VARIABLE_TYPES,
  type VariableSpec,
  validateValue,
} from '@configure-env/core';
import {
  displayPath,
  CliError,
  NO_TERMINAL,
  parseCommand,
  printWarnings,
  usageError,
} from './common.ts';
import {
  type Connection,
  type ServerRun,
  answerMessage,
  openServer,
  send,
} from './connect.ts';
import { INIT_HELP } from './help.ts';
import type { Io, Prompts } from './io.ts';

const OPTIONS = {
  from: { type: 'string' },
  force: { type: 'boolean' },
} as const;

export { STATE_IGNORE } from '@configure-env/core';

const IGNORE_LINES: Record<IgnoreStatus, string[]> = {
  created: [`Created .gitignore with ${STATE_IGNORE}`],
  added: [`Added ${STATE_IGNORE} to .gitignore`],
  present: [],
  symlink: [],
};

/** The example file `init` reads when --from is not given and it exists. */
export const DEFAULT_FROM = DEFAULT_EXAMPLE;

/** The warning the API gives for a .gitignore it could not update. */
const GITIGNORE_WARNING =
  /^cannot update \.gitignore: (.*); add .* to it yourself$/;

// An enum needs its values listed, which a single value cannot tell.
const TYPES = VARIABLE_TYPES.filter((type) => type !== 'enum');

/** The --from path as the server takes it: relative to the root, with `/`. */
function sourcePath(run: ServerRun, from: string): string {
  const path = run.context
    ? relative(run.context.root, resolve(run.context.root, from))
    : from;
  return posix.normalize(path.split(sep).join('/'));
}

/** The variable with another type; its default kept only when it still fits. */
function retype(
  variable: InferredVariable,
  type: InferredVariable['type'],
): InferredVariable {
  const { default: value, ...rest } = variable;
  const next: InferredVariable = { ...rest, type };
  if (value === undefined) return next;
  const result = validateValue({ type } as VariableSpec, String(value));
  if (result.ok && result.value !== null) next.default = result.value;
  return next;
}

const describe = (key: string, variable: InferredVariable) =>
  `${key}: ${variable.type}${variable.default === undefined ? '' : ` (${String(variable.default)})`}`;

/** Lets a person confirm the inferred types, or pick each one. */
async function review(
  prompts: Prompts,
  from: string,
  variables: Record<string, InferredVariable>,
): Promise<Record<string, InferredVariable> | undefined> {
  const keys = Object.keys(variables);
  if (!keys.length) return variables;
  prompts.note(
    keys.map((key) => describe(key, variables[key]!)).join('\n'),
    `Inferred from ${from}`,
  );
  const keep = await prompts.confirm({ message: 'Use these types?' });
  if (prompts.isCancel(keep)) return undefined;
  if (keep) return variables;
  const edited: Record<string, InferredVariable> = {};
  for (const key of keys) {
    const variable = variables[key]!;
    const type = await prompts.select({
      message: `Type of ${key}`,
      options: TYPES.map((value) => ({ value, label: value })),
      initialValue: variable.type,
    });
    if (prompts.isCancel(type)) return undefined;
    edited[key] = type === variable.type ? variable : retype(variable, type);
  }
  return edited;
}

/**
 * The schema of an init answer, else the error the CLI exits with: a schema
 * there without --force (exit 2), a --from outside the root or missing
 * (exit 2), an inferred schema that is invalid, or anything else the server
 * refused, by its message.
 */
function answer(
  run: ServerRun,
  response: { status: number; data: unknown },
  options: { from?: string; force?: boolean },
): Schema {
  if (response.status === 200) return response.data as Schema;
  if (response.status === 409 && !options.force)
    throw usageError(`${run.title} exists; pass --force to overwrite it`);
  if (options.from !== undefined) {
    if (response.status === 403)
      throw usageError(
        `--from must name a file inside the root: ${options.from}`,
      );
    if (response.status === 404)
      throw usageError(`--from: no such file: ${options.from}`);
  }
  if (response.status === 422) {
    const { errors = [] } = response.data as { errors?: SchemaError[] };
    throw new CliError(1, [
      'the inferred schema is invalid:',
      ...errors.map((error) => `  ${error.path}: ${error.message}`),
    ]);
  }
  throw new CliError(1, [answerMessage(response)]);
}

export async function initCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(INIT_HELP);
    return 0;
  }
  const run = await openServer(io, options);
  const interactive = !run.ci && !run.json;
  if (interactive && !io.isTTY) throw usageError(NO_TERMINAL);
  const connection = await run.connect();
  try {
    return await init(io, run, connection, options, interactive);
  } finally {
    await connection.close();
  }
}

/** Writes the schema, reviewed first in a terminal; resolves to the exit code. */
async function init(
  io: Io,
  run: ServerRun,
  connection: Connection,
  options: { from?: string; force?: boolean },
  interactive: boolean,
): Promise<number> {
  const { prompts } = run;
  const shownPath = run.title;
  const request: InitSchemaRequest = {
    ...(options.from === undefined
      ? {}
      : { from: sourcePath(run, options.from) }),
  };
  // --force replaces the schema there: the server takes its fingerprint.
  if (options.force) {
    const read = await send(connection, () => getSchema(connection.init()));
    if (read.status === 200 && read.data.fingerprint)
      request.fingerprint = read.data.fingerprint;
  }
  const post = async (body: InitSchemaRequest) =>
    answer(
      run,
      await send(connection, () => initSchema(body, connection.init())),
      options,
    );

  if (interactive) {
    // The schema init would write, refused as the write would be.
    const preview = await post({ ...request, preview: true });
    const document = preview.document as {
      variables: Record<string, InferredVariable>;
      files: { path: string }[];
    };
    const from = document.files[0]?.path;
    prompts.intro(`configure-env init · ${shownPath}`);
    if (from) {
      const reviewed = await review(prompts, from, document.variables);
      if (!reviewed) {
        prompts.cancel('Cancelled; nothing was written.');
        return 130;
      }
      request.variables = reviewed;
    } else prompts.log.info(`No ${DEFAULT_FROM}; starting an empty schema.`);
  }

  const written = await post(request);
  const document = written.document as {
    variables: Record<string, unknown>;
    files: { path: string }[];
  };
  const from = document.files[0]?.path;
  const warnings = written.warnings ?? [];
  const ignored = written.gitignore;
  if (ignored === undefined) {
    const reason = warnings
      .map((line) => GITIGNORE_WARNING.exec(line)?.[1])
      .find((found) => found !== undefined);
    throw new CliError(1, [
      `cannot update .gitignore: ${reason ?? 'unknown'}`,
      `${shownPath} was written; add ${STATE_IGNORE} to .gitignore yourself`,
    ]);
  }
  // The history's warnings name the state as the command line shows it.
  const statePath = run.context?.statePath;
  const shownState = statePath && displayPath(io.cwd, statePath);
  const historyWarnings = warnings
    .filter((line) => !GITIGNORE_WARNING.test(line))
    .map((line) =>
      statePath && shownState ? line.replaceAll(statePath, shownState) : line,
    );

  const variables = Object.keys(document.variables);
  const count = variables.length;
  const summary = [
    `Wrote ${shownPath}: ${count} variable${count === 1 ? '' : 's'}${from ? ` from ${from}` : ''}`,
    ...IGNORE_LINES[ignored],
  ];
  if (run.json)
    io.stdout(
      JSON.stringify({
        command: 'init',
        ok: true,
        schema: run.context?.schemaPath ?? shownPath,
        from: from ?? null,
        variables,
        gitignore: ignored,
      }),
    );
  else if (interactive) prompts.outro(summary.join('\n'));
  else summary.forEach((line) => io.stdout(line));
  printWarnings(io, [
    ...(ignored === 'symlink'
      ? [`.gitignore is a symlink; add ${STATE_IGNORE} to it yourself`]
      : []),
    ...historyWarnings,
  ]);
  return 0;
}
