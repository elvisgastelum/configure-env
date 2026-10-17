// `configure-env install mcp`: registers `configure-env mcp` in each agent's
// MCP configuration, for the project or the user, keeping every other entry.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { CliError, type Context, displayPath, usageError } from './common.ts';
import type { Io } from './io.ts';

/** The name the server has in every agent's configuration. */
export const SERVER_NAME = 'configure-env';

export const MCP_SCOPES = ['project', 'user'] as const;
export const MCP_AGENTS = [
  'claude',
  'cursor',
  'vscode',
  'codex',
  'gemini',
] as const;
export const RUNNERS = ['npx', 'global'] as const;

export type McpScope = (typeof MCP_SCOPES)[number];
export type McpAgent = (typeof MCP_AGENTS)[number];
export type Runner = (typeof RUNNERS)[number];

/** How the agent starts the server. */
export interface Launch {
  command: string;
  args: string[];
}

/** The command each runner starts: the published package, or the one on PATH. */
export function launchOf(runner: Runner, agent: McpAgent): Launch {
  const base: Launch =
    runner === 'npx'
      ? { command: 'npx', args: ['-y', '@elvisgastelum/configure-env', 'mcp'] }
      : { command: 'configure-env', args: ['mcp'] };
  // VS Code may start servers outside the workspace; it expands this one.
  return agent === 'vscode'
    ? { ...base, args: [...base.args, '--root', '${workspaceFolder}'] }
    : base;
}

/** VS Code's user folder, where its user-scope mcp.json lives. */
function vscodeUserDir(env: Io['env'], home: string): string {
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Code', 'User');
  if (process.platform === 'win32')
    return join(
      env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
    );
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Code', 'User');
}

/** Where an agent keeps its MCP servers, and under which key. */
interface Target {
  path: string;
  format: 'json' | 'toml';
  /** The JSON object that maps server names to servers. */
  key?: 'mcpServers' | 'servers';
}

/** An agent's configuration file for a scope, under the home or the project. */
export function targetOf(
  agent: McpAgent,
  scope: McpScope,
  base: string,
  env: Io['env'],
): Target {
  const json = (path: string, key: Target['key'] = 'mcpServers'): Target => ({
    path,
    format: 'json',
    key,
  });
  switch (agent) {
    case 'claude':
      return json(join(base, scope === 'user' ? '.claude.json' : '.mcp.json'));
    case 'cursor':
      return json(join(base, '.cursor', 'mcp.json'));
    case 'vscode':
      return json(
        scope === 'user'
          ? join(vscodeUserDir(env, base), 'mcp.json')
          : join(base, '.vscode', 'mcp.json'),
        'servers',
      );
    case 'gemini':
      return json(join(base, '.gemini', 'settings.json'));
    case 'codex':
      return { path: join(base, '.codex', 'config.toml'), format: 'toml' };
  }
}

/** The server entry an agent's JSON configuration holds. */
function jsonEntry(agent: McpAgent, launch: Launch): Record<string, unknown> {
  return agent === 'claude' || agent === 'vscode'
    ? { type: 'stdio', command: launch.command, args: launch.args }
    : { command: launch.command, args: launch.args };
}

export type McpStatus = 'created' | 'added' | 'updated' | 'unchanged';

/** A configuration's new text, or why it is left alone. */
type Plan =
  | { status: 'unchanged' }
  | { status: Exclude<McpStatus, 'unchanged'>; text: string }
  | { conflict: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why a configuration that registers another configure-env server is left alone. */
const DIFFERENT_SERVER = {
  conflict: `already has a different ${SERVER_NAME} server; pass --force to replace it`,
};

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The JSON configuration with the server added or replaced. */
function planJson(
  target: Target,
  current: string | undefined,
  entry: Record<string, unknown>,
  force: boolean,
): Plan {
  let document: unknown = {};
  if (current !== undefined && current.trim()) {
    try {
      document = JSON.parse(current);
    } catch {
      return {
        conflict:
          'is not plain JSON (comments are not kept); add the server to it yourself',
      };
    }
  }
  if (!isRecord(document)) return { conflict: 'does not hold a JSON object' };
  const key = target.key!;
  const servers = document[key] ?? {};
  if (!isRecord(servers)) return { conflict: `its ${key} is not an object` };
  const existing = servers[SERVER_NAME];
  if (existing !== undefined && sameJson(existing, entry))
    return { status: 'unchanged' };
  if (existing !== undefined && !force) return DIFFERENT_SERVER;
  const next = { ...document, [key]: { ...servers, [SERVER_NAME]: entry } };
  return {
    status:
      current === undefined
        ? 'created'
        : existing === undefined
          ? 'added'
          : 'updated',
    text: `${JSON.stringify(next, null, 2)}\n`,
  };
}

/** The TOML table Codex reads the server from. */
function tomlTable(launch: Launch): string {
  // A JSON string is a valid TOML basic string.
  const args = launch.args.map((arg) => JSON.stringify(arg)).join(', ');
  return `[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${args}]\n`;
}

const TABLE_HEADER = new RegExp(
  `^\\[mcp_servers\\.(?:${SERVER_NAME}|"${SERVER_NAME}")\\][ \\t]*$`,
  'm',
);

/** The TOML configuration with the server's table added or replaced. */
function planToml(
  current: string | undefined,
  launch: Launch,
  force: boolean,
): Plan {
  const table = tomlTable(launch);
  if (current === undefined) return { status: 'created', text: table };
  const header = TABLE_HEADER.exec(current);
  if (!header) {
    const separator =
      !current || current.endsWith('\n\n')
        ? ''
        : current.endsWith('\n')
          ? '\n'
          : '\n\n';
    return { status: 'added', text: `${current}${separator}${table}` };
  }
  const start = header.index;
  const rest = current.slice(start + header[0].length);
  const next = /^\[/m.exec(rest);
  const end = next ? start + header[0].length + next.index : current.length;
  const block = current.slice(start, end);
  if (block.trim() === table.trim()) return { status: 'unchanged' };
  if (!force) return DIFFERENT_SERVER;
  const tail = current.slice(end);
  return {
    status: 'updated',
    text: `${current.slice(0, start)}${table}${tail ? `\n${tail}` : ''}`,
  };
}

const readText = (path: string) =>
  readFile(path, 'utf8').then(
    (text) => text,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    },
  );

/** Writes next to the file, then renames over it, keeping its mode. */
async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const mode = await stat(path).then(
    (stats) => stats.mode & 0o777,
    () => undefined,
  );
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, text, mode === undefined ? {} : { mode });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export interface McpChoices {
  scope: McpScope;
  runner: Runner;
  agents: McpAgent[];
}

export interface InstalledServer {
  agent: McpAgent;
  scope: McpScope;
  path: string;
  status: McpStatus;
  command: string;
  args: string[];
}

const toSlash = (path: string) => path.split(sep).join('/');

/**
 * A configuration's path as `install mcp` prints it: `~/...` for the user
 * scope when it is under the home folder, else relative to the base.
 */
export function shownPath(
  path: string,
  scope: McpScope,
  base: string,
  home: string,
): string {
  const fromHome = relative(home, path);
  return scope === 'user' && !fromHome.startsWith('..')
    ? `~/${toSlash(fromHome)}`
    : toSlash(relative(base, path));
}

/**
 * Registers the server for each agent: every configuration is read and
 * checked before any is written, so a refused run changes nothing.
 */
export async function installMcp(
  context: Context,
  choices: McpChoices,
  {
    force,
    base,
    interactive,
  }: { force: boolean; base: string; interactive: boolean },
): Promise<number> {
  const { io, prompts } = context;
  const home = io.env.HOME || io.env.USERPROFILE || homedir();
  const show = (path: string) => shownPath(path, choices.scope, base, home);

  const planned: {
    agent: McpAgent;
    target: Target;
    launch: Launch;
    plan: Plan;
  }[] = [];
  for (const agent of choices.agents) {
    const target = targetOf(agent, choices.scope, base, io.env);
    const launch = launchOf(choices.runner, agent);
    let current: string | undefined;
    try {
      current = await readText(target.path);
    } catch (error) {
      throw new CliError(1, [
        `cannot read ${show(target.path)}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`,
      ]);
    }
    const plan =
      target.format === 'toml'
        ? planToml(current, launch, force)
        : planJson(target, current, jsonEntry(agent, launch), force);
    if ('conflict' in plan)
      throw usageError(`${show(target.path)} ${plan.conflict}`);
    planned.push({ agent, target, launch, plan });
  }

  const servers: InstalledServer[] = [];
  const lines: string[] = [];
  for (const { agent, target, launch, plan } of planned) {
    if ('text' in plan) {
      try {
        await writeAtomically(target.path, plan.text);
      } catch (error) {
        lines.forEach((line) => io.stdout(line));
        throw new CliError(1, [
          `cannot write ${show(target.path)}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`,
        ]);
      }
    }
    const status = 'status' in plan ? plan.status : 'unchanged';
    servers.push({
      agent,
      scope: choices.scope,
      path: target.path,
      status,
      command: launch.command,
      args: launch.args,
    });
    lines.push(`${status.padEnd(10)} ${show(target.path)} (${agent})`);
  }

  if (context.json)
    io.stdout(
      JSON.stringify({
        command: 'install',
        subject: 'mcp',
        ok: true,
        server: SERVER_NAME,
        servers: servers.map((server) => ({
          ...server,
          path: displayPath(io.cwd, server.path),
        })),
      }),
    );
  else if (interactive)
    prompts.outro(
      `${lines.join('\n')}\nRestart the agent, or reload its MCP servers, to start it.`,
    );
  else lines.forEach((line) => io.stdout(line));
  return 0;
}
