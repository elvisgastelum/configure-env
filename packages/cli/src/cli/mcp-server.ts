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
import { VARIABLE_NAME, schemaFingerprint } from '@configure-env/core';
import { readFile } from 'node:fs/promises';
import { CliError, contextOf } from './common.ts';
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
  const run = (argv: string[]) => runCommand(options, argv);

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
      const path = await schemaPath(options);
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

  return server;
}

/** The absolute schema path, as the commands resolve it. */
async function schemaPath(options: McpOptions): Promise<string> {
  const context = await contextOf(
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
    },
  );
  return context.schemaPath;
}
