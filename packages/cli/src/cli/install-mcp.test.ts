// `configure-env install mcp`: registers the MCP server in each agent's
// configuration, keeping every other entry.

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
import { targetOf } from './install-mcp.ts';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

// Runs after a temp file is written, before it is renamed into place: to
// stand for another program writing the configuration meanwhile.
const hooks = vi.hoisted(() => ({
  afterTemp: undefined as ((temp: string) => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      const path = String(args[0]);
      if (hooks.afterTemp && path.endsWith('.tmp')) await hooks.afterTemp(path);
    },
  };
});
afterEach(() => {
  hooks.afterTemp = undefined;
});

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

  it('replaces the Codex table with its subtables, keeping what follows', async () => {
    const path = join(dirs.root, '.codex/config.toml');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      '[mcp_servers."configure-env"]\ncommand = "old"\n\n[mcp_servers.configure-env.env]\nA = "1"\n\n[profiles.z]\nmodel = "y"\n',
    );
    const result = await install(['--ci', '--agent', 'codex', '--force']);
    expect(result.code).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(
      '[mcp_servers.configure-env]\ncommand = "npx"\nargs = ["-y", "@elvisgastelum/configure-env", "mcp"]\n\n[profiles.z]\nmodel = "y"\n',
    );
  });

  it('reads a Codex table holding multi-line values, keeping them', async () => {
    const path = join(dirs.root, '.codex/config.toml');
    await mkdir(dirname(path), { recursive: true });
    const tail =
      '\n[profiles.z]\nmatrix = [\n  [1, 2],\n  [3]\n]\nnote = """\n[not.a.table]\n"""\n';
    await writeFile(
      path,
      `[mcp_servers.configure-env]\ncommand = "old"\nargs = [\n  "mcp",\n  ["x"]\n]\n${tail}`,
    );
    const result = await install(['--ci', '--agent', 'codex', '--force']);
    expect(result.code).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(
      `[mcp_servers.configure-env]\ncommand = "npx"\nargs = ["-y", "@elvisgastelum/configure-env", "mcp"]\n${tail}`,
    );
  });

  it("adds the Codex table when another server's args only mention it", async () => {
    const path = join(dirs.root, '.codex/config.toml');
    await mkdir(dirname(path), { recursive: true });
    const current =
      'mcp_servers = { db = { command = "x", args = ["configure-env"] } }\n';
    await writeFile(path, current);
    const result = await install(['--ci', '--agent', 'codex']);
    expect(result.code).toBe(0);
    expect(await readFile(path, 'utf8')).toMatch(
      /^\[mcp_servers\.configure-env\]$/m,
    );
  });

  it('ends the Codex table at an array of tables, keeping it', async () => {
    const path = join(dirs.root, '.codex/config.toml');
    await mkdir(dirname(path), { recursive: true });
    const current =
      '[mcp_servers.configure-env]\ncommand = "npx"\nargs = ["-y", "@elvisgastelum/configure-env", "mcp"]\n\n[[profiles]]\nname = "a"\n';
    await writeFile(path, current);
    const same = await install(['--ci', '--agent', 'codex']);
    expect(same).toMatchObject({
      code: 0,
      out: ['unchanged  .codex/config.toml (codex)'],
    });
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
      '[mcp_servers.configure-env]\ncommand = "configure-env"\nargs = ["mcp"]\n\n[[profiles]]\nname = "a"\n',
    );
  });

  it.each([
    [
      'under [mcp_servers]',
      '[mcp_servers]\nconfigure-env = { command = "x" }\n',
    ],
    ['as a dotted key', 'mcp_servers.configure-env.command = "x"\n'],
    ['inline', 'mcp_servers = { "configure-env" = { command = "x" } }\n'],
  ])(
    'refuses a Codex server registered %s, even with --force',
    async (_form, text) => {
      const path = join(dirs.root, '.codex/config.toml');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      const result = await install(['--ci', '--agent', 'codex', '--force']);
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toMatch(
        /in a form install mcp does not edit/,
      );
      expect(await readFile(path, 'utf8')).toBe(text);
    },
  );

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

  it('writes through a symlinked configuration, keeping the link', async () => {
    const real = join(home, 'dotfiles', 'claude.json');
    await mkdir(dirname(real), { recursive: true });
    await writeFile(real, JSON.stringify({ projects: {} }));
    const link = join(home, '.claude.json');
    await symlink(real, link);
    const result = await install(['--ci', '--scope', 'user']);
    expect(result.code).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readJson(real)).toEqual({
      projects: {},
      mcpServers: { 'configure-env': { type: 'stdio', ...NPX } },
    });
  });

  it('creates the file a dangling symlink points to', async () => {
    const real = join(home, 'dotfiles', 'cursor.json');
    await mkdir(join(home, '.cursor'), { recursive: true });
    await symlink(real, join(home, '.cursor', 'mcp.json'));
    const result = await install([
      '--ci',
      '--scope',
      'user',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(0);
    expect(
      (await lstat(join(home, '.cursor', 'mcp.json'))).isSymbolicLink(),
    ).toBe(true);
    expect(await readJson(real)).toEqual({
      mcpServers: { 'configure-env': NPX },
    });
  });

  it('leaves a configuration another program wrote meanwhile', async () => {
    const path = join(dirs.root, '.mcp.json');
    await writeFile(path, '{}');
    hooks.afterTemp = async () => {
      hooks.afterTemp = undefined;
      await writeFile(path, '{"theirs":true}');
    };
    const result = await install(['--ci']);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(
      /\.mcp\.json changed while install mcp ran; run it again/,
    );
    expect(await readFile(path, 'utf8')).toBe('{"theirs":true}');
  });

  it('puts the configurations it wrote back when a later one fails', async () => {
    const claude = join(dirs.root, '.mcp.json');
    await writeFile(claude, '{"mine":1}');
    hooks.afterTemp = async (temp) => {
      if (temp.includes('.cursor')) throw new Error('disk full');
    };
    const result = await install([
      '--ci',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/cannot write \.cursor\/mcp\.json/);
    expect(result.err.join('\n')).toMatch(/were put back/);
    expect(await readFile(claude, 'utf8')).toBe('{"mine":1}');
    await expect(stat(join(dirs.root, '.cursor/mcp.json'))).rejects.toThrow();
  });

  it('prints ok: false with --json when a write fails', async () => {
    hooks.afterTemp = async (temp) => {
      if (temp.includes('.cursor')) throw new Error('disk full');
    };
    const result = await install([
      '--json',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(1);
    const document = JSON.parse(result.out[0]!) as {
      ok: boolean;
      servers: unknown[];
      errors: { kind: string; path: string; message: string }[];
    };
    expect(document).toMatchObject({ ok: false, servers: [] });
    expect(document.errors[0]).toMatchObject({
      kind: 'file',
      path: '.cursor/mcp.json',
    });
    await expect(stat(join(dirs.root, '.mcp.json'))).rejects.toThrow();
  });

  it('names each file it could not put back in its own --json error', async () => {
    let claudeTemps = 0;
    hooks.afterTemp = async (temp) => {
      if (temp.includes('.cursor')) throw new Error('disk full');
      // The second .mcp.json temp is the one that would put it back.
      if (temp.includes('.mcp.json') && ++claudeTemps === 2)
        throw new Error('disk full');
    };
    await writeFile(join(dirs.root, '.mcp.json'), '{}');
    const result = await install([
      '--json',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(1);
    const { errors } = JSON.parse(result.out[0]!) as {
      errors: { path: string; message: string }[];
    };
    expect(errors.map((error) => error.path)).toEqual([
      '.cursor/mcp.json',
      '.mcp.json',
    ]);
    expect(errors[1]!.message).toMatch(/could not be put back/);
  });

  it('writes a configuration two agents share through a symlink once', async () => {
    await mkdir(join(dirs.root, '.gemini'), { recursive: true });
    await mkdir(join(dirs.root, '.cursor'), { recursive: true });
    await writeFile(join(dirs.root, '.cursor/mcp.json'), '{}');
    await symlink(
      join(dirs.root, '.cursor/mcp.json'),
      join(dirs.root, '.gemini/settings.json'),
    );
    const result = await install([
      '--ci',
      '--agent',
      'cursor',
      '--agent',
      'gemini',
    ]);
    expect(result).toMatchObject({
      code: 0,
      out: [
        'added      .cursor/mcp.json (cursor)',
        'added      .gemini/settings.json (gemini)',
      ],
    });
    expect(await readJson(join(dirs.root, '.cursor/mcp.json'))).toEqual({
      mcpServers: { 'configure-env': NPX },
    });
  });

  it('refuses agents that share a file but register the server differently', async () => {
    await mkdir(join(dirs.root, '.cursor'), { recursive: true });
    await writeFile(join(dirs.root, '.mcp.json'), '{}');
    await symlink(
      join(dirs.root, '.mcp.json'),
      join(dirs.root, '.cursor/mcp.json'),
    );
    const result = await install([
      '--ci',
      '--agent',
      'claude',
      '--agent',
      'cursor',
    ]);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(
      /\.cursor\/mcp\.json and \.mcp\.json are the same file/,
    );
    expect(result.err.join('\n')).toMatch(
      /pass only one of --agent claude and --agent cursor/,
    );
    expect(await readFile(join(dirs.root, '.mcp.json'), 'utf8')).toBe('{}');
  });

  it('refuses a project config that links outside the project', async () => {
    const outside = join(home, '.zshrc');
    await writeFile(outside, 'export A=1\n');
    await mkdir(join(dirs.root, '.codex'), { recursive: true });
    await symlink(outside, join(dirs.root, '.codex/config.toml'));
    const result = await install(['--ci', '--agent', 'codex']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(
      /\.codex\/config\.toml is a symlink to .*, outside the project/,
    );
    expect(await readFile(outside, 'utf8')).toBe('export A=1\n');
  });

  it('refuses a dangling project link that points outside the project', async () => {
    const outside = join(home, 'created-by-link.json');
    await mkdir(join(dirs.root, '.cursor'), { recursive: true });
    await symlink(outside, join(dirs.root, '.cursor/mcp.json'));
    const result = await install(['--ci', '--agent', 'cursor']);
    expect(result.code).toBe(2);
    await expect(stat(outside)).rejects.toThrow();
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
