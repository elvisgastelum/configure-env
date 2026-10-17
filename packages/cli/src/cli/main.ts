// `configure-env [command] [options]`: picks the command and runs it.

import { applyCommand } from './apply.ts';
import { checkCommand } from './check.ts';
import { CliError, usageError } from './common.ts';
import { getCommand, setCommand, unsetCommand } from './edit.ts';
import { MAIN_HELP, VERSION } from './help.ts';
import { historyCommand } from './history.ts';
import { initCommand } from './init.ts';
import { installCommand } from './install.ts';
import { listCommand } from './inspect.ts';
import type { Io } from './io.ts';
import { mcpCommand } from './mcp.ts';
import { serveCommand } from './serve.ts';

type Command = (args: string[], io: Io) => Promise<number>;

export const COMMANDS: Record<string, Command> = {
  apply: applyCommand,
  check: checkCommand,
  init: initCommand,
  set: setCommand,
  get: getCommand,
  unset: unsetCommand,
  list: listCommand,
  history: historyCommand,
  install: installCommand,
  serve: serveCommand,
  mcp: mcpCommand,
};

const has = (args: readonly string[], ...flags: string[]) =>
  args.some((arg) => flags.includes(arg));

async function dispatch(argv: string[], io: Io): Promise<number> {
  // `pnpm <script> -- args` can pass the separator through.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (has(args, '--version', '-v')) {
    io.stdout(VERSION);
    return 0;
  }
  const [first] = args;
  if (first === undefined || first.startsWith('-')) {
    if (has(args, '--help', '-h')) {
      io.stdout(MAIN_HELP);
      return 0;
    }
    return applyCommand(args, io);
  }
  const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
  if (!command)
    throw usageError(
      `unknown command: ${first}`,
      'run configure-env --help for the commands',
    );
  return command(args.slice(1), io);
}

/** Runs the CLI; resolves to the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    const [first, ...rest] = error.lines;
    io.stderr(`configure-env: ${first}`);
    rest.forEach((line) => io.stderr(line));
    return error.code;
  }
}
