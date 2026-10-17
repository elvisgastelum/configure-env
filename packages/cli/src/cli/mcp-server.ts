// The MCP server `configure-env mcp` runs: tools that let an agent read and
// change a project's env files without a secret value ever reaching it.
//
// Every tool runs the CLI's own commands in-process with --ci --json, so it
// keeps their validation, masking and guards; none of them reveals a value
// (there is no tool for `get --reveal`), and a secret only goes in through
// a value made here (generate) or one the human types outside the chat.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  type EnvSchema,
  type SchemaDocument,
  VARIABLE_NAME,
  getValue,
  keysOf,
  parseDotenv,
  parseSchemaText,
  recordHistory,
  schemaChanges,
  schemaFingerprint,
  unquoteValue,
  writeSchemaFile,
} from '@configure-env/core';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  CliError,
  type Context,
  contextOf,
  loadContextSchema,
} from './common.ts';
import type { Io, Prompts } from './io.ts';
import { main } from './main.ts';

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
the chat. Start with list_variables and check.`;

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

/** The global options a tool's command runs with. */
function globals(options: McpOptions, file?: string): string[] {
  return [
    '--ci',
    '--json',
    '--no-color',
    ...(options.root === undefined ? [] : [`--root=${options.root}`]),
    ...(options.schema === undefined ? [] : [`--schema=${options.schema}`]),
    ...(options.state === undefined ? [] : [`--state=${options.state}`]),
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
  const run = async (argv: string[]) =>
    maskSecrets(options, await runCommand(options, argv));

  server.registerTool(
    'list_variables',
    {
      title: 'List variables',
      description:
        "Each schema file's variables: whether they are set and valid, the value (secrets masked) and the description.",
      inputSchema: { file },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(await run(['list', ...globals(options, input.file)])),
  );

  server.registerTool(
    'get_value',
    {
      title: 'Get a value',
      description:
        "One variable's value in one file. A secret's value is masked; no tool reveals it.",
      inputSchema: { key, file },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(await run(['get', ...globals(options, input.file), input.key])),
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
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run([
          'check',
          ...globals(options, input.file),
          ...(input.strict ? ['--strict'] : []),
        ]),
      ),
  );

  server.registerTool(
    'history',
    {
      title: 'Change history',
      description:
        'The latest changes to the env files and the schema, with previews; a secret is masked.',
      inputSchema: { file },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      resultOf(await run(['history', ...globals(options, input.file)])),
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Read the schema',
      description:
        'The schema file (env.schema.json) as text, with the fingerprint update_schema needs.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const path = (await contextFor(options)).schemaPath;
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        return textResult(
          `cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`,
          true,
        );
      }
      return textResult(
        JSON.stringify({ path, fingerprint: schemaFingerprint(text), text }),
      );
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
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const secrets = await secretKeys(options, Object.keys(input.values));
      if (secrets.length)
        return textResult(
          `${secrets.join(', ')}: secret; its value never goes through the chat. Call generate_secret for a value the project makes, or request_secret for one only the user has.`,
          true,
        );
      return resultOf(
        await run([
          'set',
          ...globals(options, input.file),
          ...(input.create ? ['--create'] : []),
          ...Object.entries(input.values).map(
            ([name, value]) => `${name}=${value}`,
          ),
        ]),
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
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run([
          'set',
          ...globals(options, input.file),
          ...input.keys.map((name) => `--generate=${name}`),
        ]),
      ),
  );

  server.registerTool(
    'request_secret',
    {
      title: 'Ask the user for a secret',
      description:
        'Changes nothing: answers the command the user runs in their own terminal to type a secret, so it never passes through the chat. Relay it to the user, then call check.',
      inputSchema: { key, file },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const schema = await loadContextSchema(await contextFor(options));
      if (!Object.hasOwn(schema.variables, input.key))
        return textResult(`${input.key}: is not in the schema`, true);
      const flags = [
        ...(options.root === undefined
          ? []
          : [`--root ${quote(options.root)}`]),
        ...(options.schema === undefined
          ? []
          : [`--schema ${quote(options.schema)}`]),
        ...(input.file === undefined ? [] : [`--file ${quote(input.file)}`]),
      ];
      const command = [
        'configure-env set',
        ...flags,
        `--prompt ${input.key}`,
      ].join(' ');
      return textResult(
        JSON.stringify({
          key: input.key,
          command,
          npx: command.replace(
            /^configure-env/,
            'npx @elvisgastelum/configure-env',
          ),
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
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      resultOf(
        await run(['unset', ...globals(options, input.file), ...input.keys]),
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
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      resultOf(
        await run([
          'apply',
          ...globals(options, input.file),
          ...(input.generate ?? []).map((name) => `--generate=${name}`),
          ...(input.defer ?? []).map((name) => `--defer=${name}`),
          ...(input.prune ? ['--prune'] : []),
        ]),
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
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) =>
      resultOf(
        await run([
          'check',
          ...globals(options),
          '--fix',
          ...(input.strict ? ['--strict'] : []),
        ]),
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
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const context = await contextFor(options);
      const unmasked = await unmaskedSecrets(
        context.schemaPath,
        input.fingerprint,
        input.document,
      );
      if (unmasked.length)
        return textResult(
          JSON.stringify({
            ok: false,
            kind: 'secret',
            message: `the edit would unmask ${unmasked.join(', ')}: a secret variable keeps \`"secret": true\` and stays in the schema; ask the user to change it themselves. Nothing was written.`,
          }),
          true,
        );
      const result = await writeSchemaFile(
        context.schemaPath,
        input.document as SchemaDocument,
        { fingerprint: input.fingerprint },
      );
      if (!result.ok)
        return textResult(
          JSON.stringify({
            ok: false,
            kind: result.kind,
            message:
              result.kind === 'stale'
                ? 'the schema changed since it was read; call get_schema and make the edit again'
                : 'the edit was refused; nothing was written',
            errors: result.errors,
          }),
          true,
        );
      const history = await recordHistory(
        context.statePath,
        'cli',
        result.written
          ? schemaChanges(
              relative(context.root, context.schemaPath),
              result.previous,
              result.file.text,
            )
          : [],
      );
      return textResult(
        JSON.stringify({
          ok: true,
          written: result.written,
          fingerprint: result.file.fingerprint,
          ...(history.warnings.length ? { warnings: history.warnings } : {}),
        }),
      );
    },
  );

  return server;
}

/** The context the commands resolve from the server's global options. */
function contextFor(options: McpOptions): Promise<Context> {
  return contextOf(
    {
      stdout: () => undefined,
      stderr: () => undefined,
      env: options.env,
      isTTY: false,
      cwd: options.cwd,
      prompts: NO_PROMPTS,
    },
    {
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.schema === undefined ? {} : { schema: options.schema }),
      ...(options.state === undefined ? {} : { state: options.state }),
    },
  );
}

/** The variables among `keys` the schema marks secret. */
async function secretKeys(
  options: McpOptions,
  keys: readonly string[],
): Promise<string[]> {
  const schema = await loadContextSchema(await contextFor(options));
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
 * The secret variables of the schema at `fingerprint` that `document` would
 * unmask: removed, or no longer `secret: true`. A schema changed since the
 * fingerprint answers none; the write then refuses it as stale.
 */
async function unmaskedSecrets(
  path: string,
  fingerprint: string,
  document: Record<string, unknown>,
): Promise<string[]> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined || schemaFingerprint(text) !== fingerprint) return [];
  const current = parseSchemaText(text);
  if (!current.ok) return [];
  const next = (document.variables ?? {}) as Record<string, unknown>;
  return Object.entries(current.schema.variables)
    .filter(([, spec]) => spec.secret)
    .map(([name]) => name)
    .filter((name) => {
      const spec = Object.hasOwn(next, name) ? next[name] : undefined;
      return !(
        typeof spec === 'object' &&
        spec !== null &&
        (spec as { secret?: unknown }).secret === true
      );
    });
}

/**
 * The values the schema files hold for the keys {@link isHidden} keeps out
 * of every answer, whether or not the file lists them: as written and
 * unquoted, longest first.
 */
async function hiddenValues(
  context: Context,
  schema: EnvSchema,
): Promise<string[]> {
  const values = new Set<string>();
  for (const spec of schema.files) {
    const text = await readFile(resolve(context.root, spec.path), 'utf8').catch(
      () => undefined,
    );
    if (text === undefined) continue;
    const doc = parseDotenv(text);
    for (const name of keysOf(doc).filter((key) => isHidden(schema, key))) {
      const raw = getValue(doc, name);
      if (raw === undefined) continue;
      for (const value of [raw, unquoteValue(raw)])
        if (value) values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/**
 * The shortest hidden value replaced where it appears inside longer text:
 * a shorter one is masked only where it is a whole JSON string, so a
 * common word that happens to be a secret does not garble the rest.
 */
const SUBSTRING_MIN = 8;

/**
 * `value` with nothing hidden left in it, at any depth: an entry whose
 * `key` is hidden trades its `value` for a mask, and a string that is a
 * hidden value, or holds one of 8 characters or more, is masked.
 */
function maskJson(
  value: unknown,
  hidden: (name: string) => boolean,
  values: readonly string[],
): unknown {
  if (typeof value === 'string') return maskText(value, values, true);
  if (Array.isArray(value))
    return value.map((item) => maskJson(item, hidden, values));
  if (typeof value !== 'object' || value === null) return value;
  const record = Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      maskJson(item, hidden, values),
    ]),
  );
  if (
    typeof record.key === 'string' &&
    hidden(record.key) &&
    typeof record.value === 'string'
  ) {
    delete record.value;
    return { ...record, masked: MASK };
  }
  return record;
}

/** `text` with the hidden values masked; `whole` masks an exact match too. */
function maskText(
  text: string,
  values: readonly string[],
  whole: boolean,
): string {
  if (whole && values.includes(text)) return MASK;
  let masked = text;
  for (const value of values)
    if (value.length >= SUBSTRING_MIN) masked = masked.replaceAll(value, MASK);
  return masked;
}

/**
 * A command run with nothing hidden left in it (see {@link maskJson}); a
 * line that is not JSON, a log line, has its longer hidden values masked.
 * The commands mask secrets themselves; this holds even where one does
 * not, such as a secret in a file whose variables leave it out. When the
 * schema cannot be read, nothing can be masked, so the output is withheld
 * and only the command's errors, which never hold a value, are answered.
 */
async function maskSecrets(
  options: McpOptions,
  run: CommandRun,
): Promise<CommandRun> {
  let context: Context, schema: EnvSchema;
  try {
    context = await contextFor(options);
    schema = await loadContextSchema(context);
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
  const values = await hiddenValues(context, schema);
  const scrub = (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return maskText(line, values, false);
    }
    return JSON.stringify(maskJson(parsed, hidden, values));
  };
  return { ...run, out: run.out.map(scrub), err: run.err.map(scrub) };
}
