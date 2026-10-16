// `configure-env init`: writes a starting env.schema.json, inferred from an
// example env file when there is one.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  DEFAULT_EXAMPLE,
  type IgnoreStatus,
  type InferredVariable,
  STATE_IGNORE,
  VARIABLE_TYPES,
  type VariableSpec,
  filePathProblem,
  ignoreState,
  inferSchema,
  inferVariables,
  parseSchema,
  schemaChanges,
  validateValue,
} from '@configure-env/core';
import {
  displayPath,
  CliError,
  type Context,
  contextOf,
  NO_TERMINAL,
  parseCommand,
  printWarnings,
  recordRun,
  usageError,
} from './common.ts';
import { INIT_HELP } from './help.ts';
import type { Io } from './io.ts';

const OPTIONS = {
  from: { type: 'string' },
  force: { type: 'boolean' },
} as const;

export { STATE_IGNORE } from '@configure-env/core';

const IGNORE_LINES: Record<IgnoreStatus, string[]> = {
  created: [`Created .gitignore with ${STATE_IGNORE}`],
  added: [`Added ${STATE_IGNORE} to .gitignore`],
  present: [],
};

/** The example file `init` reads when --from is not given and it exists. */
export const DEFAULT_FROM = DEFAULT_EXAMPLE;

// An enum needs its values listed, which a single value cannot tell.
const TYPES = VARIABLE_TYPES.filter((type) => type !== 'enum');

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The --from path relative to the root, as the schema writes it. */
async function sourcePath(
  root: string,
  from: string | undefined,
): Promise<string | undefined> {
  if (from === undefined)
    return (await exists(resolve(root, DEFAULT_FROM)))
      ? DEFAULT_FROM
      : undefined;
  const path = relative(root, resolve(root, from)).split(sep).join('/');
  const problem = filePathProblem(path);
  if (problem)
    throw usageError(`--from must name a file inside the root: ${from}`);
  if (!(await exists(resolve(root, path))))
    throw usageError(`--from: no such file: ${from}`);
  return path;
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
  { prompts }: Context,
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

export async function initCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(INIT_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const { root, schemaPath, prompts } = context;
  const interactive = !context.ci && !context.json;
  if (interactive && !io.isTTY) throw usageError(NO_TERMINAL);

  const shownPath = displayPath(io.cwd, schemaPath);
  if (!options.force && (await exists(schemaPath)))
    throw usageError(`${shownPath} exists; pass --force to overwrite it`);
  const from = await sourcePath(root, options.from);
  let variables = from
    ? inferVariables(await readFile(resolve(root, from), 'utf8'))
    : {};

  if (interactive) {
    prompts.intro(`configure-env init · ${shownPath}`);
    if (from) {
      const reviewed = await review(context, from, variables);
      if (!reviewed) {
        prompts.cancel('Cancelled; nothing was written.');
        return 130;
      }
      variables = reviewed;
    } else prompts.log.info(`No ${DEFAULT_FROM}; starting an empty schema.`);
  }

  // The schema init infers, with the variables as the person reviewed them.
  const schema = { ...inferSchema(from, ''), variables };
  const checked = parseSchema(schema);
  if (!checked.ok)
    throw new CliError(1, [
      'the inferred schema is invalid:',
      ...checked.errors.map((error) => `  ${error.path}: ${error.message}`),
    ]);
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  // The schema it replaces, for the history: --force may overwrite one.
  const previous = options.force
    ? await readFile(schemaPath, 'utf8').catch(() => undefined)
    : undefined;
  try {
    await writeFile(schemaPath, text, { flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      throw usageError(`${shownPath} exists; pass --force to overwrite it`);
    throw new CliError(1, [
      `cannot write ${shownPath}: ${code ?? (error as Error).message}`,
    ]);
  }

  // Only once the schema is written: a refused init changes nothing.
  let ignored: IgnoreStatus;
  try {
    ignored = await ignoreState(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new CliError(1, [
      `cannot update .gitignore: ${code ?? (error as Error).message}`,
      `${shownPath} was written; add ${STATE_IGNORE} to .gitignore yourself`,
    ]);
  }

  const warnings = await recordRun(
    context,
    schemaChanges(
      relative(root, schemaPath).split(sep).join('/'),
      previous,
      text,
    ),
  );

  const count = Object.keys(variables).length;
  const summary = [
    `Wrote ${shownPath}: ${count} variable${count === 1 ? '' : 's'}${from ? ` from ${from}` : ''}`,
    ...IGNORE_LINES[ignored],
  ];
  if (context.json)
    io.stdout(
      JSON.stringify({
        command: 'init',
        ok: true,
        schema: schemaPath,
        from: from ?? null,
        variables: Object.keys(variables),
        gitignore: ignored,
      }),
    );
  else if (interactive) prompts.outro(summary.join('\n'));
  else summary.forEach((line) => io.stdout(line));
  printWarnings(io, warnings);
  return 0;
}
