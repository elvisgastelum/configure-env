// `configure-env install mcp`: registers `configure-env mcp` in each agent's
// MCP configuration, for the project or the user, keeping every other entry.

import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isInside } from '@configure-env/core';
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

/** Whether two JSON values are equal, whatever the order of their keys. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
}

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

/** The server's name as a TOML key: bare, or in either kind of quotes. */
const TOML_NAME = `(?:${SERVER_NAME}|"${SERVER_NAME}"|'${SERVER_NAME}')`;

/**
 * A table header line, `[name]` or an array of tables' `[[name]]`, with
 * its dotted name and whether it is an array.
 */
const HEADER = /^\s*\[(\[)?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;

/** A table name that is the server's, or one of its subtables. */
const SERVER_TABLE = new RegExp(
  `^mcp_servers\\s*\\.\\s*${TOML_NAME}(\\s*\\..*)?$`,
);

/** A key line that registers the server another way than its own table. */
const OTHER_FORM = new RegExp(
  `^\\s*(?:mcp_servers\\s*\\.\\s*${TOML_NAME}\\s*[.=]|mcp_servers\\s*=.*${TOML_NAME})`,
);
const KEY_IN_SERVERS = new RegExp(`^\\s*${TOML_NAME}\\s*[.=]`);

/**
 * Where the server's table and its subtables sit in a Codex configuration,
 * as line indexes, or that it is registered in a form this command does
 * not edit: under `[mcp_servers]`, as a dotted key, or inline.
 */
function findServerTable(
  lines: readonly string[],
): { start: number; end: number } | 'other' | undefined {
  let table = '';
  let start: number | undefined;
  let end: number | undefined;
  for (const [index, line] of lines.entries()) {
    const header = HEADER.exec(line);
    if (header) {
      table = header[2]!;
      // An array of tables is never the server's: it ends the block.
      const ours = !header[1] && SERVER_TABLE.test(table);
      if (ours && start !== undefined && end !== undefined) return 'other';
      if (ours && start === undefined) start = index;
      if (!ours && start !== undefined && end === undefined) end = index;
      continue;
    }
    if (
      (table === '' && OTHER_FORM.test(line)) ||
      (table === 'mcp_servers' && KEY_IN_SERVERS.test(line))
    )
      return 'other';
  }
  if (start === undefined) return undefined;
  return { start, end: end ?? lines.length };
}

/** The TOML configuration with the server's table added or replaced. */
function planToml(
  current: string | undefined,
  launch: Launch,
  force: boolean,
): Plan {
  const table = tomlTable(launch);
  if (current === undefined) return { status: 'created', text: table };
  const lines = current.split('\n');
  const found = findServerTable(lines);
  if (found === 'other')
    return {
      conflict: `registers ${SERVER_NAME} in a form install mcp does not edit (under [mcp_servers], a dotted key, inline, or its tables split across the file); change it yourself`,
    };
  if (!found) {
    const separator =
      !current || current.endsWith('\n\n')
        ? ''
        : current.endsWith('\n')
          ? '\n'
          : '\n\n';
    return { status: 'added', text: `${current}${separator}${table}` };
  }
  // The block ends at the next table; blank lines before it stay outside.
  let { end } = found;
  while (end > found.start + 1 && !lines[end - 1]!.trim()) end -= 1;
  const block = lines.slice(found.start, end).join('\n');
  if (block.trim() === table.trim()) return { status: 'unchanged' };
  if (!force) return DIFFERENT_SERVER;
  const head = lines.slice(0, found.start).join('\n');
  const tail = lines.slice(end).join('\n');
  return {
    status: 'updated',
    text: `${head}${head ? '\n' : ''}${table}${tail ? `${tail.startsWith('\n') ? '' : '\n'}${tail}` : ''}`,
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

/**
 * The file a configuration path stands for: a symlink's target, so a
 * config kept in a dotfiles folder is changed there and stays linked.
 */
async function realTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // A dangling symlink: create the file it points to.
  const link = await lstat(path).catch(() => undefined);
  return link?.isSymbolicLink()
    ? realTarget(resolve(dirname(path), await readlink(path)))
    : path;
}

/** A configuration that changed between its read and its write. */
class Changed extends Error {}

/**
 * Writes next to the file, then renames over it, keeping its mode. The
 * file must still hold `expected` (undefined: not exist), else another
 * program wrote it meanwhile and it is left alone.
 */
async function writeAtomically(
  path: string,
  text: string,
  expected: string | undefined,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const mode = await stat(path).then(
    (stats) => stats.mode & 0o777,
    () => undefined,
  );
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, text, mode === undefined ? {} : { mode });
    if ((await readText(path)) !== expected) throw new Changed();
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
  // A symlinked configuration is written where it points only inside the
  // project (project scope) or the home folder (user scope): a cloned
  // repository must not make install mcp change a file anywhere else.
  const folder = choices.scope === 'user' ? home : base;
  // Both spellings: a dangling link's target is not resolved like the folder.
  const bounds = [folder, await realpath(folder).catch(() => folder)];

  const planned: {
    agent: McpAgent;
    target: Target;
    launch: Launch;
    plan: Plan;
    /** The file written: the path, or the file its symlink points to. */
    file: string;
    current: string | undefined;
    /** What the agent's configuration holds for the server, to compare. */
    entry: string;
    /** Another agent's configuration is the same file and writes it. */
    shared: boolean;
  }[] = [];
  for (const agent of choices.agents) {
    const target = targetOf(agent, choices.scope, base, io.env);
    const launch = launchOf(choices.runner, agent);
    let current: string | undefined, file: string;
    try {
      file = await realTarget(target.path);
      current = await readText(file);
    } catch (error) {
      throw new CliError(1, [
        `cannot read ${show(target.path)}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`,
      ]);
    }
    if (file !== target.path && !bounds.some((bound) => isInside(bound, file)))
      throw usageError(
        `${show(target.path)} is a symlink to ${file}, outside the ${choices.scope === 'user' ? 'home folder' : 'project'}`,
        'register the server in that file yourself, or replace the link',
      );
    const entry =
      target.format === 'toml'
        ? tomlTable(launch)
        : JSON.stringify([target.key, jsonEntry(agent, launch)]);
    // Two agents whose configurations are one file, through a symlink: it
    // is written once, when both would register the same server.
    const same = planned.find((other) => other.file === file);
    if (same && same.entry !== entry)
      throw usageError(
        `${show(target.path)} and ${show(same.target.path)} are the same file, which ${agent} and ${same.agent} would register differently`,
        `pass only one of --agent ${same.agent} and --agent ${agent}`,
      );
    if (same) {
      planned.push({ ...same, agent, target, launch, shared: true });
      continue;
    }
    const plan =
      target.format === 'toml'
        ? planToml(current, launch, force)
        : planJson(target, current, jsonEntry(agent, launch), force);
    if ('conflict' in plan)
      throw usageError(`${show(target.path)} ${plan.conflict}`);
    planned.push({
      agent,
      target,
      launch,
      plan,
      file,
      current,
      entry,
      shared: false,
    });
  }

  const servers: InstalledServer[] = [];
  const lines: string[] = [];
  /** What each written file held before, to put back on a failure. */
  const written: {
    path: string;
    file: string;
    previous?: string;
    text: string;
  }[] = [];
  const document = (ok: boolean) => ({
    command: 'install',
    subject: 'mcp',
    ok,
    server: SERVER_NAME,
    servers: servers.map((server) => ({
      ...server,
      path: displayPath(io.cwd, server.path),
    })),
  });

  for (const {
    agent,
    target,
    launch,
    plan,
    file,
    current,
    shared,
  } of planned) {
    if ('text' in plan && !shared) {
      try {
        await writeAtomically(file, plan.text, current);
        written.push({
          path: target.path,
          file,
          text: plan.text,
          ...(current === undefined ? {} : { previous: current }),
        });
      } catch (error) {
        const failure =
          error instanceof Changed
            ? `${show(target.path)} changed while install mcp ran; run it again`
            : `cannot write ${show(target.path)}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`;
        const kept = await restore(written);
        servers.length = 0;
        const stays = kept.map((path) => ({
          path,
          message: `${show(path)} could not be put back and keeps the server`,
        }));
        if (context.json) {
          io.stdout(
            JSON.stringify({
              ...document(false),
              errors: [{ path: target.path, message: failure }, ...stays].map(
                (error) => ({
                  kind: 'file',
                  path: displayPath(io.cwd, error.path),
                  message: error.message,
                }),
              ),
            }),
          );
          return 1;
        }
        throw new CliError(1, [
          failure,
          ...(written.length > kept.length
            ? ['the configurations written before it were put back']
            : []),
          ...stays.map((error) => error.message),
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

  if (context.json) io.stdout(JSON.stringify(document(true)));
  else if (interactive)
    prompts.outro(
      `${lines.join('\n')}\nRestart the agent, or reload its MCP servers, to start it.`,
    );
  else lines.forEach((line) => io.stdout(line));
  return 0;
}

/**
 * Puts each written configuration back as it was, newest first: its old
 * text, or no file when the run created it. Answers the paths it could not
 * put back; one changed since the run wrote it is left alone.
 */
async function restore(
  written: readonly {
    path: string;
    file: string;
    previous?: string;
    text: string;
  }[],
): Promise<string[]> {
  const kept: string[] = [];
  for (const { path, file, previous, text } of [...written].reverse()) {
    try {
      if ((await readText(file)) !== text) throw new Changed();
      if (previous === undefined) await rm(file);
      else await writeAtomically(file, previous, text);
    } catch {
      kept.push(path);
    }
  }
  return kept;
}
