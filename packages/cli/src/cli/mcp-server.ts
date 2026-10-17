// The MCP server `configure-env mcp` runs: tools that let an agent read and
// change a project's env files without a secret value ever reaching it.
//
// Every tool runs the CLI's own commands in-process with --ci --json, so it
// keeps their validation, masking and guards; none of them reveals a value
// (there is no tool for `get --reveal`), and a secret only goes in through
// a value made here (generate) or one the human types outside the chat.
// Every tool takes `env`, the environment to work on, passed on as --env:
// the commands, and the schema tools, reach it through the configure-env
// API (connect.ts), so another machine's project is worked on as this one.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  getFiles,
  getSchema,
  replaceSchema,
} from '@configure-env/api-client/client';
import {
  type EnvSchema,
  type SchemaError,
  VARIABLE_NAME,
  getValue,
  keysOf,
  parseDotenv,
  unquoteValue,
} from '@configure-env/core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CliError,
  type Context,
  contextOf,
  selectedEnvironment,
} from './common.ts';
import {
  type Connection,
  type ProjectRun,
  type ServerRun,
  answerMessage,
  openProject,
  openServer,
  send,
} from './connect.ts';
import { LOCAL } from './environments.ts';
import type { Io, Prompts } from './io.ts';
import { main } from './main.ts';
import { defaultFile } from './target.ts';

/** Where the server's commands run, as the global options name it. */
export interface McpOptions {
  /** What relative paths resolve against: the client's working directory. */
  cwd: string;
  env: Io['env'];
  version: string;
  root?: string;
  schema?: string;
  state?: string;
}

export const MCP_INSTRUCTIONS = `configure-env edits a project's env files from its schema (env.schema.json).
Secret values never pass through you: tools mask them, and none reveals one.
To give a secret variable a value, call generate_secret for a value the project
makes itself, or request_secret for one only the user has, then relay the
command it returns to the user. Never ask the user to paste a secret into
the chat. Start with list_variables and check. Every tool takes env, an
environment configure-env env add stored, to work on that server's project;
local, this project, by default.`;

/** Prompts that fail: a command run with --ci never asks, so none is called. */
const noPrompt = (): never => {
  throw new Error('configure-env mcp never prompts');
};
const NO_PROMPTS: Prompts = {
  intro: () => undefined,
  outro: () => undefined,
  cancel: () => undefined,
  note: () => undefined,
  log: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    step: () => undefined,
    success: () => undefined,
  },
  isCancel: (value): value is symbol => typeof value === 'symbol',
  multiselect: noPrompt,
  select: noPrompt,
  text: noPrompt,
  password: noPrompt,
  confirm: noPrompt,
  spinner: () => ({
    start: () => undefined,
    stop: () => undefined,
    error: () => undefined,
  }),
};

/** A command's output as `--json` printed it, and its exit code. */
export interface CommandRun {
  code: number;
  out: string[];
  err: string[];
}

/** The environment a tool works on: its `env`, else the server's default. */
const environmentOf = (options: McpOptions, env?: string) =>
  selectedEnvironment({ env: options.env } as Io, { env });

/**
 * The global options the server's own reads take. --root, --schema and
 * --state name this project, so they go with `local` only: another
 * environment's server owns its project.
 */
function valuesFor(options: McpOptions, env?: string) {
  const local = environmentOf(options, env) === LOCAL;
  return {
    ...(env === undefined ? {} : { env }),
    ...(!local || options.root === undefined ? {} : { root: options.root }),
    ...(!local || options.schema === undefined
      ? {}
      : { schema: options.schema }),
    ...(!local || options.state === undefined ? {} : { state: options.state }),
  };
}

/** The global options a tool's command runs with, as valuesFor names them. */
function globals(options: McpOptions, file?: string, env?: string): string[] {
  const values = valuesFor(options, env);
  return [
    '--ci',
    '--json',
    '--no-color',
    ...(values.env === undefined ? [] : [`--env=${values.env}`]),
    ...(values.root === undefined ? [] : [`--root=${values.root}`]),
    ...(values.schema === undefined ? [] : [`--schema=${values.schema}`]),
    ...(values.state === undefined ? [] : [`--state=${values.state}`]),
    ...(file === undefined ? [] : [`--file=${file}`]),
  ];
}

/**
 * Runs one CLI command in-process, with no terminal, no stdin and no
 * prompts: the server's own stdin and stdout carry the protocol.
 */
export async function runCommand(
  options: McpOptions,
  argv: string[],
): Promise<CommandRun> {
  const result: CommandRun = { code: -1, out: [], err: [] };
  try {
    result.code = await main(argv, {
      stdout: (line) => result.out.push(line),
      stderr: (line) => result.err.push(line),
      env: { ...options.env, NO_COLOR: '1' },
      isTTY: false,
      stdinIsTTY: false,
      cwd: options.cwd,
      prompts: NO_PROMPTS,
    });
  } catch (error) {
    result.code = error instanceof CliError ? error.code : 1;
    result.err.push(
      `configure-env: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}

/** A tool result from a command run: its JSON, then what it logged. */
function resultOf(run: CommandRun): CallToolResult {
  const text = [...run.out, ...run.err].join('\n');
  return {
    content: [{ type: 'text', text: text || `exit ${run.code}` }],
    ...(run.code === 0 ? {} : { isError: true }),
  };
}

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

const env = z
  .string()
  .min(1)
  .optional()
  .describe(
    'The environment to work on, as configure-env env add stored it (configure-env env list names them); local, this project, by default.',
  );
const key = z
  .string()
  .regex(VARIABLE_NAME, 'a variable name: letters, digits and _');
const file = z
  .string()
  .min(1)
  .optional()
  .describe(
    'The schema file to work on, as the schema lists its path; set, get and unset default to the only file that is not a template.',
  );

/** Creates the server, its tools registered; connect it to a transport. */
export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer(
    { name: 'configure-env', version: options.version },
    { instructions: MCP_INSTRUCTIONS },
  );
  // Every command's output is masked again here, whatever the command did.
  const run = async (argv: string[], env?: string) =>
    maskSecrets(options, env, await runCommand(options, argv));

  server.registerTool(
    'list_variables',
    {
      title: 'List variables',
      description:
        "Each schema file's variables: whether they are set and valid, the value (secrets masked) and the description.",
      inputSchema: { file, env },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          ['list', ...globals(options, input.file, input.env)],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'get_value',
    {
      title: 'Get a value',
      description:
        "One variable's value in one file. A secret's value is masked; no tool reveals it.",
      inputSchema: { key, file, env },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          ['get', ...globals(options, input.file, input.env), input.key],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'check',
    {
      title: 'Check the env files',
      description:
        'Every problem by file, as `configure-env check --json` reports it: drift, invalid values and lines, broken rules, unknown keys, what git does not ignore. Changes nothing.',
      inputSchema: {
        file,
        strict: z
          .boolean()
          .optional()
          .describe('Report unknown keys as errors, not warnings.'),
        env,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          [
            'check',
            ...globals(options, input.file, input.env),
            ...(input.strict ? ['--strict'] : []),
          ],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'history',
    {
      title: 'Change history',
      description:
        'The latest changes to the env files and the schema, with previews; a secret is masked.',
      inputSchema: { file, env },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          ['history', ...globals(options, input.file, input.env)],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Read the schema',
      description:
        'The schema file (env.schema.json) as text, with the fingerprint update_schema needs.',
      inputSchema: { env },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const target = await openServer(
        ioFor(options),
        valuesFor(options, input.env),
      );
      const path = target.context?.schemaPath ?? target.title;
      const read = await request(target, (connection) =>
        send(connection, () => getSchema(connection.init())),
      );
      if (read.status !== 200) return textResult(answerMessage(read), true);
      const { fingerprint, text } = read.data;
      if (text === undefined || fingerprint === undefined) {
        // The server names its schema from its root: what stopped it is
        // named here by this path.
        const message = read.data.errors[0]?.message ?? '';
        const code = message.slice(message.lastIndexOf(': ') + 2);
        return textResult(`cannot read ${path}: ${code}`, true);
      }
      return textResult(JSON.stringify({ path, fingerprint, text }));
    },
  );

  server.registerTool(
    'set_values',
    {
      title: 'Set values',
      description:
        'Sets variables in one file, validated against the schema, keeping every other line. Refuses a secret variable: use generate_secret or request_secret for those.',
      inputSchema: {
        file,
        values: z
          .record(key, z.string())
          .refine(
            (values) => Object.keys(values).length > 0,
            'one value at least',
          )
          .describe('The values by variable name.'),
        create: z
          .boolean()
          .optional()
          .describe('Create the file when it does not exist.'),
        env,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const secrets = await secretKeys(
        options,
        input.env,
        Object.keys(input.values),
      );
      if (secrets.length)
        return textResult(
          `${secrets.join(', ')}: secret; its value never goes through the chat. Call generate_secret for a value the project makes, or request_secret for one only the user has.`,
          true,
        );
      return resultOf(
        await run(
          [
            'set',
            ...globals(options, input.file, input.env),
            ...(input.create ? ['--create'] : []),
            ...Object.entries(input.values).map(
              ([name, value]) => `${name}=${value}`,
            ),
          ],
          input.env,
        ),
      );
    },
  );

  server.registerTool(
    'generate_secret',
    {
      title: 'Generate secrets',
      description:
        "Gives variables a random value made on this machine, as the schema's rules allow, keeping a value already set. The value is never returned.",
      inputSchema: {
        file,
        keys: z.array(key).min(1).describe('The variables to generate.'),
        env,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          [
            'set',
            ...globals(options, input.file, input.env),
            ...input.keys.map((name) => `--generate=${name}`),
          ],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'request_secret',
    {
      title: 'Ask the user for a secret',
      description:
        'Changes nothing: answers the command the user runs in their own terminal to type a secret, so it never passes through the chat. Relay it to the user, then call check.',
      inputSchema: { key, file, env },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const { project, context } = await projectFor(options, input.env);
      const { schema } = project;
      if (!Object.hasOwn(schema.variables, input.key))
        return textResult(`${input.key}: is not in the schema`, true);
      if (
        input.file !== undefined &&
        !schema.files.some((spec) => spec.path === input.file)
      )
        return textResult(`${input.file}: is not in the schema`, true);
      // The file set edits: without --file, the default one; with several,
      // set asks the user for --file, so none is checked.
      const edited = input.file ?? defaultFile(schema)?.path;
      const exists =
        edited === undefined || (await fileExists(project, edited));
      // The user runs it in their own terminal, from any folder: every path
      // is absolute, and the state is the one this server's commands use.
      // Another environment is named by --env, from the folder that stores
      // it.
      const flags = [
        ...(context
          ? [
              `--root ${quote(context.root)}`,
              ...(options.schema === undefined
                ? []
                : [`--schema ${quote(context.schemaPath)}`]),
              ...(options.state === undefined
                ? []
                : [`--state ${quote(context.statePath)}`]),
            ]
          : [`--env ${quote(project.name)}`]),
        ...(input.file === undefined ? [] : [`--file ${quote(input.file)}`]),
        ...(exists ? [] : ['--create']),
      ];
      const folder = context ? '' : `cd ${quote(resolve(options.cwd))} && `;
      const args = [...flags, `--prompt ${input.key}`].join(' ');
      const command = `${folder}configure-env set ${args}`;
      return textResult(
        JSON.stringify({
          key: input.key,
          command,
          npx: `${folder}npx @elvisgastelum/configure-env set ${args}`,
          message: `Ask the user to run this in their terminal (in Claude Code: ! ${command}); it prompts for ${input.key} without echoing it. Never ask them to paste the value here.`,
        }),
      );
    },
  );

  server.registerTool(
    'unset',
    {
      title: 'Remove variables',
      description:
        'Removes variables from one file, keeping every other line. A protected value is refused; ask the user before removing a secret.',
      inputSchema: {
        file,
        keys: z.array(key).min(1).describe('The variables to remove.'),
        env,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      resultOf(
        await run(
          ['unset', ...globals(options, input.file, input.env), ...input.keys],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'apply',
    {
      title: 'Write the env files',
      description:
        'Writes the env files the schema describes, keeping what they hold. Secrets go in through generate (made here) or defer (left for the user); a required value that is missing fails the run and names it.',
      inputSchema: {
        file,
        generate: z
          .array(key)
          .optional()
          .describe('Secrets to give a random value made on this machine.'),
        defer: z
          .array(key)
          .optional()
          .describe('Values to leave unset for the user to give later.'),
        prune: z
          .boolean()
          .optional()
          .describe('Remove the keys the schema does not declare.'),
        env,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      resultOf(
        await run(
          [
            'apply',
            ...globals(options, input.file, input.env),
            ...(input.generate ?? []).map((name) => `--generate=${name}`),
            ...(input.defer ?? []).map((name) => `--defer=${name}`),
            ...(input.prune ? ['--prune'] : []),
          ],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'fix_gitignore',
    {
      title: 'Fix git-ignore lines',
      description:
        'Adds the git-ignore lines check reports missing, so git never commits an env file or the state; answers the check after.',
      inputSchema: {
        strict: z
          .boolean()
          .optional()
          .describe('Report unknown keys as errors in the check after.'),
        env,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run(
          [
            'check',
            ...globals(options, undefined, input.env),
            '--fix',
            ...(input.strict ? ['--strict'] : []),
          ],
          input.env,
        ),
      ),
  );

  server.registerTool(
    'update_schema',
    {
      title: 'Update the schema',
      description:
        'Replaces the schema (env.schema.json) with a document, validated first. Pass the fingerprint get_schema gave: a schema changed since is refused.',
      inputSchema: {
        document: z
          .record(z.string(), z.unknown())
          .describe('The whole schema document, as JSON.'),
        fingerprint: z.string().describe('The fingerprint get_schema gave.'),
        env,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const target = await openServer(
        ioFor(options),
        valuesFor(options, input.env),
      );
      const path = target.context?.schemaPath ?? target.title;
      // The server refuses a document that would unmask a value
      // (keepSecretsMasked), and records the change as the CLI's: the
      // client is the CLI, as for every other tool's writes.
      const response = await request(target, (connection) =>
        send(connection, () =>
          replaceSchema(
            {
              fingerprint: input.fingerprint,
              document: input.document,
              keepSecretsMasked: true,
            },
            connection.init(),
          ),
        ),
      );
      const refused = (kind: string, message: string, errors: unknown) =>
        textResult(JSON.stringify({ ok: false, kind, message, errors }), true);
      const { data, status } = response as { data: unknown; status: number };
      if (status === 200) {
        const written = data as { fingerprint: string; warnings?: string[] };
        return textResult(
          JSON.stringify({
            ok: true,
            written: written.fingerprint !== input.fingerprint,
            fingerprint: written.fingerprint,
            ...(written.warnings?.length ? { warnings: written.warnings } : {}),
          }),
        );
      }
      if (status === 403) {
        const { keys = [] } = data as { keys?: string[] };
        return textResult(
          JSON.stringify({
            ok: false,
            kind: 'secret',
            message: `the edit would unmask ${keys.join(', ')}. A secret variable must keep \`"secret": true\` and stay in the schema, and a key an env file already holds a value for must be declared with \`"secret": true\`, also when the edit adds that file; ask the user to make this change themselves. Nothing was written.`,
          }),
          true,
        );
      }
      if (status === 409)
        return refused(
          'stale',
          'the schema changed since it was read; call get_schema and make the edit again',
          [
            {
              path: '(root)',
              message: `${path} changed since it was read; reload it and make the edit again`,
            },
          ],
        );
      if (status === 422)
        return refused(
          'invalid',
          'the edit was refused; nothing was written',
          (data as { errors?: SchemaError[] }).errors ?? [],
        );
      return refused('io', 'the edit was refused; nothing was written', [
        { path: '(root)', message: answerMessage(response) },
      ]);
    },
  );

  return server;
}

/** The io the server's own reads run with: no terminal, no prompts. */
const ioFor = (options: McpOptions): Io => ({
  stdout: () => undefined,
  stderr: () => undefined,
  env: options.env,
  isTTY: false,
  cwd: options.cwd,
  prompts: NO_PROMPTS,
});

/** Runs requests on the server `target` names, closing it after. */
async function request<T>(
  target: ServerRun | ProjectRun,
  requests: (connection: Connection) => Promise<T>,
): Promise<T> {
  const connection = await target.connect();
  try {
    return await requests(connection);
  } finally {
    await connection.close();
  }
}

/**
 * The project a tool works on, its schema read (see openProject); for
 * `local`, its paths too, where the secret values masked are read.
 */
async function projectFor(
  options: McpOptions,
  env: string | undefined,
): Promise<{ project: ProjectRun; context?: Context }> {
  const io = ioFor(options);
  const values = valuesFor(options, env);
  const project = await openProject(io, values);
  if (project.remote) return { project };
  return { project, context: await contextOf(io, { ...values, env: LOCAL }) };
}

/** Whether the schema file at `path` exists, as the project's server sees it. */
async function fileExists(project: ProjectRun, path: string): Promise<boolean> {
  const files = await request(project, (connection) =>
    send(connection, () => getFiles(connection.init())),
  );
  if (files.status !== 200) throw new CliError(1, [answerMessage(files)]);
  return files.data.files.some((file) => file.path === path && file.exists);
}

/** The variables among `keys` the schema marks secret. */
async function secretKeys(
  options: McpOptions,
  env: string | undefined,
  keys: readonly string[],
): Promise<string[]> {
  const { schema } = (await projectFor(options, env)).project;
  return keys.filter((name) => isSecret(schema, name));
}

/** Whether the schema declares `name` with `secret: true`. */
const isSecret = (schema: EnvSchema, name: string) =>
  Object.hasOwn(schema.variables, name) &&
  schema.variables[name]!.secret === true;

/**
 * Whether a key's value stays out of every answer: a secret variable, or a
 * key the schema does not declare, whose sensitivity nobody stated.
 */
const isHidden = (schema: EnvSchema, name: string) =>
  !Object.hasOwn(schema.variables, name) || isSecret(schema, name);

/** A shell word: quoted when it holds anything but safe characters. */
const quote = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

const MASK = '••••';

/**
 * The values the schema files hold for the secret variables, whether or
 * not the file lists them: as written and unquoted, longest first. These
 * are masked wherever they appear; an undeclared key's value only in its
 * own entry (see {@link maskJson}).
 */
async function secretValues(
  context: Context,
  schema: EnvSchema,
): Promise<SecretValue[]> {
  const values = new Map<string, boolean>();
  for (const spec of schema.files) {
    const text = await readFile(resolve(context.root, spec.path), 'utf8').catch(
      () => undefined,
    );
    if (text === undefined) continue;
    const doc = parseDotenv(text);
    for (const name of keysOf(doc).filter((key) => isSecret(schema, key))) {
      const raw = getValue(doc, name);
      if (raw === undefined) continue;
      for (const value of [raw, unquoteValue(raw)])
        if (value) values.set(value, value.length >= SECRET_MIN);
    }
  }
  return [...values]
    .map(([text, inside]) => ({ text, inside }))
    .sort((a, b) => b.text.length - a.text.length);
}

/** A secret value, and whether it is masked inside longer text too. */
interface SecretValue {
  text: string;
  inside: boolean;
}

/**
 * The shortest secret masked inside longer text too, such as a password in
 * a non-secret URL: any shorter one only where it is a whole value.
 */
const SECRET_MIN = 4;

/**
 * `value` with nothing hidden left in it, at any depth: an entry whose
 * `key` is hidden trades its `value` for a mask, and a string that is a
 * secret value, or holds one (see {@link SecretValue}), is masked.
 */
function maskJson(
  value: unknown,
  hidden: (name: string) => boolean,
  values: readonly SecretValue[],
): unknown {
  if (typeof value === 'string') return maskText(value, values);
  if (Array.isArray(value))
    return value.map((item) => maskJson(item, hidden, values));
  if (typeof value !== 'object' || value === null) return value;
  const entry = value as Record<string, unknown>;
  const ownHidden = typeof entry.key === 'string' && hidden(entry.key);
  const record = Object.fromEntries(
    Object.entries(entry).map(([name, item]) => [
      name,
      // Names come from the schema and the CLI, never from a value.
      NAME_FIELDS.has(name) ? item : maskJson(item, hidden, values),
    ]),
  );
  if (!ownHidden) return record;
  // The entry's own values: a list's or get's `value`, history's previews.
  for (const name of PREVIEW_FIELDS)
    if (typeof record[name] === 'string') record[name] = MASK;
  if (typeof record.value !== 'string') return record;
  delete record.value;
  return { ...record, masked: MASK };
}

/** The fields a history entry previews its key's values in. */
const PREVIEW_FIELDS = ['before', 'after'];

/** The fields that name a key or a file, left as they are. */
const NAME_FIELDS = new Set(['key', 'file', 'path']);

/** `text` with the secret values masked: a whole match, or one inside it. */
function maskText(text: string, values: readonly SecretValue[]): string {
  if (values.some((value) => value.text === text)) return MASK;
  let masked = text;
  for (const value of values)
    if (value.inside) masked = masked.replaceAll(value.text, MASK);
  return masked;
}

/**
 * A command run with nothing hidden left in it (see {@link maskJson}); a
 * line that is not JSON, a log line, has its secret values masked.
 * The commands mask secrets themselves; this holds even where one does
 * not, such as a secret in a file whose variables leave it out. When the
 * schema cannot be read, nothing can be masked, so the output is withheld
 * and only the command's errors, which never hold a value, are answered.
 */
async function maskSecrets(
  options: McpOptions,
  env: string | undefined,
  run: CommandRun,
): Promise<CommandRun> {
  let context: Context | undefined, schema: EnvSchema;
  try {
    const found = await projectFor(options, env);
    ({ context } = found);
    schema = found.project.schema;
  } catch {
    return {
      ...run,
      out: [],
      err: run.out.length
        ? [
            ...run.err,
            'configure-env: output withheld: the schema could not be read to mask it',
          ]
        : run.err,
    };
  }
  const hidden = (name: string) => isHidden(schema, name);
  // Another environment's server masks its secrets itself: their values
  // are never read here.
  const values = context ? await secretValues(context, schema) : [];
  const scrub = (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return maskText(line, values);
    }
    return JSON.stringify(maskJson(parsed, hidden, values));
  };
  return { ...run, out: run.out.map(scrub), err: run.err.map(scrub) };
}
