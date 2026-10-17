// `configure-env install mcp`: registers the MCP server in each agent's
// configuration, keeping every other entry.

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { targetOf } from './install-mcp.ts';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject(null);
let home = '';
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'configure-env-home-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const install = (
  args: string[],
  options: { isTTY?: boolean; prompts?: never } = {},
) =>
  run(['install', 'mcp', ...args], {
    cwd: dirs.root,
    env: { HOME: home },
    ...options,
  });

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

const NPX = {
  command: 'npx',
  args: ['-y', '@elvisgastelum/configure-env', 'mcp'],
};

describe('install mcp', () => {
  it('registers the server for Claude Code in the project by default', async () => {
    const result = await install(['--ci']);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(['created    .mcp.json (claude)']);
    expect(await readJson(join(dirs.root, '.mcp.json'))).toEqual({
      mcpServers: { 'configure-env': { type: 'stdio', ...NPX } },
    });
  });

  it("writes each agent's own file and shape", async () => {
    const result = await install([
      '--ci',
      '--agent',
      'cursor',
      '--agent',
      'vscode',
      '--agent',
      'gemini',
      '--agent',
      'codex',
      '--runner',
      'global',
    ]);
    expect(result.code).toBe(0);
    const global = { command: 'configure-env', args: ['mcp'] };
    expect(await readJson(join(dirs.root, '.cursor/mcp.json'))).toEqual({
      mcpServers: { 'configure-env': global },
    });
    expect(await readJson(join(dirs.root, '.vscode/mcp.json'))).toEqual({
      servers: {
        'configure-env': {
          type: 'stdio',
          command: 'configure-env',
          args: ['mcp', '--root', '${workspaceFolder}'],
        },
      },
    });
    expect(await readJson(join(dirs.root, '.gemini/settings.json'))).toEqual({
      mcpServers: { 'configure-env': global },
    });
    expect(await readFile(join(dirs.root, '.codex/config.toml'), 'utf8')).toBe(
      '[mcp_servers.configure-env]\ncommand = "configure-env"\nargs = ["mcp"]\n',
    );
  });

  it('keeps the other servers and keys, and is unchanged when run again', async () => {
    const path = join(dirs.root, '.mcp.json');
    await writeFile(
      path,
      JSON.stringify({ other: 1, mcpServers: { db: { command: 'db' } } }),
    );
    const first = await install(['--ci']);
    expect(first.out).toEqual(['added      .mcp.json (claude)']);
    expect(await readJson(path)).toEqual({
      other: 1,
      mcpServers: {
        db: { command: 'db' },
        'configure-env': { type: 'stdio', ...NPX },
      },
    });
    const again = await install(['--ci']);
    expect(again).toMatchObject({
      code: 0,
      out: ['unchanged  .mcp.json (claude)'],
    });
  });

  it('counts the same server with its keys in another order unchanged', async () => {
    const path = join(dirs.root, '.mcp.json');
    const before = JSON.stringify({
      mcpServers: {
        'configure-env': { args: NPX.args, command: 'npx', type: 'stdio' },
      },
    });
    await writeFile(path, before);
    const result = await install(['--ci']);
    expect(result).toMatchObject({
      code: 0,
      out: ['unchanged  .mcp.json (claude)'],
    });
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('refuses to replace a different server without --force, writing nothing', async () => {
    const path = join(dirs.root, '.mcp.json');
    const before = JSON.stringify({
      mcpServers: { 'configure-env': { command: 'old' } },
    });
    await writeFile(path, before);
    const refused = await install([
      '--ci',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toMatch(/pass --force to replace it/);
    expect(await readFile(path, 'utf8')).toBe(before);
    await expect(stat(join(dirs.root, '.cursor/mcp.json'))).rejects.toThrow();

    const forced = await install(['--ci', '--force']);
    expect(forced.out).toEqual(['updated    .mcp.json (claude)']);
    expect(await readJson(path)).toEqual({
      mcpServers: { 'configure-env': { type: 'stdio', ...NPX } },
    });
  });

  it('refuses a configuration that is not plain JSON', async () => {
    const path = join(dirs.root, '.vscode/mcp.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '// mine\n{ "servers": {} }\n');
    const result = await install(['--ci', '--agent', 'vscode']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/is not plain JSON/);
    expect(await readFile(path, 'utf8')).toBe('// mine\n{ "servers": {} }\n');
  });

  it('appends the Codex table, keeping the rest, and replaces it with --force', async () => {
    const path = join(dirs.root, '.codex/config.toml');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'model = "x"\n\n[mcp_servers.db]\ncommand = "db"\n');
    expect((await install(['--ci', '--agent', 'codex'])).code).toBe(0);
    const added = await readFile(path, 'utf8');
    expect(added).toBe(
      'model = "x"\n\n[mcp_servers.db]\ncommand = "db"\n\n[mcp_servers.configure-env]\ncommand = "npx"\nargs = ["-y", "@elvisgastelum/configure-env", "mcp"]\n',
    );
    const refused = await install([
      '--ci',
      '--agent',
      'codex',
      '--runner',
      'global',
    ]);
    expect(refused.code).toBe(2);
    const forced = await install([
      '--ci',
      '--agent',
      'codex',
      '--runner',
      'global',
      '--force',
    ]);
    expect(forced.code).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(
      'model = "x"\n\n[mcp_servers.db]\ncommand = "db"\n\n[mcp_servers.configure-env]\ncommand = "configure-env"\nargs = ["mcp"]\n',
    );
  });

  it("registers for the user in the home folder, keeping the file's mode", async () => {
    const path = join(home, '.claude.json');
    await writeFile(path, JSON.stringify({ projects: {} }), { mode: 0o600 });
    const result = await install([
      '--ci',
      '--scope',
      'user',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      'added      ~/.claude.json (claude)',
      'created    ~/.cursor/mcp.json (cursor)',
    ]);
    expect(await readJson(path)).toEqual({
      projects: {},
      mcpServers: { 'configure-env': { type: 'stdio', ...NPX } },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const vscode = targetOf('vscode', 'user', home, {}).path;
    expect(vscode.startsWith(home)).toBe(true);
  });

  it('prints one JSON document with --json', async () => {
    const result = await install(['--json', '--agent', 'cursor']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toEqual({
      command: 'install',
      subject: 'mcp',
      ok: true,
      server: 'configure-env',
      servers: [
        {
          agent: 'cursor',
          scope: 'project',
          path: '.cursor/mcp.json',
          status: 'created',
          ...NPX,
        },
      ],
    });
  });

  it('asks for the scope, the agents and the runner in a terminal', async () => {
    const { prompts, calls } = scriptedPrompts({
      'Where should the MCP server be registered?': 'project',
      'Which agents should start it?': ['claude', 'gemini'],
      'How should the agents start it?': 'global',
    });
    const result = await run(['install', 'mcp'], {
      cwd: dirs.root,
      env: { HOME: home },
      isTTY: true,
      prompts,
    });
    expect(result.code).toBe(0);
    expect(calls.map((call) => call.message)).toEqual([
      'Where should the MCP server be registered?',
      'Which agents should start it?',
      'How should the agents start it?',
    ]);
    expect(await readJson(join(dirs.root, '.gemini/settings.json'))).toEqual({
      mcpServers: {
        'configure-env': { command: 'configure-env', args: ['mcp'] },
      },
    });
  });

  it('refuses options that are not for it', async () => {
    expect((await install(['--ci', '--scope', 'local'])).code).toBe(2);
    expect((await install(['--ci', '--agent', 'agents'])).code).toBe(2);
    const mode = await install(['--ci', '--mode', 'copy']);
    expect(mode.code).toBe(2);
    expect(mode.err.join('\n')).toMatch(/--mode is for install skill/);
    const runner = await run(['install', 'skill', '--ci', '--runner', 'npx'], {
      cwd: dirs.root,
      env: { HOME: home },
    });
    expect(runner.code).toBe(2);
    expect(runner.err.join('\n')).toMatch(/--runner is for install mcp/);
  });
});
