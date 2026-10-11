import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject(null);
const root = () => dirs.root;

// The skill folder the package ships, as install.ts resolves it.
const SOURCE = fileURLToPath(
  new URL('../../skills/configure-env', import.meta.url),
);
const CLAUDE = join('.claude', 'skills', 'configure-env');
const AGENTS = join('.agents', 'skills', 'configure-env');

const home = { dir: '' };
beforeEach(async () => {
  home.dir = await mkdtemp(join(tmpdir(), 'configure-env-home-'));
});
afterEach(async () => {
  await rm(home.dir, { recursive: true, force: true });
});

const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) =>
  run(['install', 'skill', ...argv], {
    cwd: root(),
    env: { HOME: home.dir },
    ...options,
  });

/** Makes the root a git repository; returns its git dir. */
async function gitInit(dir = root()) {
  const gitDir = join(dir, '.git');
  await mkdir(gitDir, { recursive: true });
  return gitDir;
}

/** Every file under `dir`, relative, with its bytes. */
async function tree(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(dir, path)] = (await readFile(path)).toString('base64');
  }
  return files;
}

const isLinkTo = async (path: string, target: string) =>
  (await lstat(path)).isSymbolicLink() && (await readlink(path)) === target;

describe('install skill', () => {
  it('copies the skill into the project byte for byte', async () => {
    const result = await cli(['--ci', '--scope', 'project', '--mode', 'copy']);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect(result.out).toEqual([`installed  ${CLAUDE} (copy)`]);
    const target = join(root(), CLAUDE);
    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(await tree(target)).toEqual(await tree(SOURCE));
    expect(Object.keys(await tree(target))).toContain('SKILL.md');
  });

  it('links the skill into the project', async () => {
    const result = await cli([
      '--ci',
      '--scope',
      'project',
      '--mode',
      'symlink',
    ]);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect(result.out).toEqual([`linked     ${CLAUDE} (symlink)`]);
    const target = join(root(), CLAUDE);
    expect(await isLinkTo(target, SOURCE)).toBe(true);
    expect(await realpath(target)).toBe(await realpath(SOURCE));
  });

  it('defaults to project and copy with --ci', async () => {
    const result = await cli(['--ci']);
    expect(result.code).toBe(0);
    expect((await lstat(join(root(), CLAUDE))).isDirectory()).toBe(true);
  });

  it('defaults to project and copy without a terminal', async () => {
    const result = await cli([]);
    expect(result.code).toBe(0);
    expect((await lstat(join(root(), CLAUDE))).isDirectory()).toBe(true);
  });

  it('installs at the git top level from a subdirectory', async () => {
    await gitInit();
    await mkdir(join(root(), 'packages', 'app'), { recursive: true });
    const result = await cli([
      '--ci',
      '--root',
      join(root(), 'packages', 'app'),
    ]);
    expect(result.code).toBe(0);
    expect((await lstat(join(root(), CLAUDE))).isDirectory()).toBe(true);
  });

  it('installs for both agents; a repeated agent counts once', async () => {
    const result = await cli([
      '--ci',
      '--agent',
      'claude',
      '--agent',
      'agents',
      '--agent',
      'claude',
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `installed  ${CLAUDE} (copy)`,
      `installed  ${AGENTS} (copy)`,
    ]);
    expect(await tree(join(root(), AGENTS))).toEqual(await tree(SOURCE));
  });

  it.each([
    ['copy', 'installed ', '(copy)'],
    ['symlink', 'linked    ', '(symlink)'],
  ])('installs for the user with --mode %s', async (mode, status, shown) => {
    const result = await cli([
      '--ci',
      '--scope',
      'user',
      '--mode',
      mode,
      '--agent',
      'agents',
    ]);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect(result.out).toEqual([
      `${status} ~/.agents/skills/configure-env ${shown}`,
    ]);
    const target = join(home.dir, AGENTS);
    if (mode === 'symlink') expect(await isLinkTo(target, SOURCE)).toBe(true);
    else expect(await tree(target)).toEqual(await tree(SOURCE));
    await expect(lstat(join(root(), '.agents'))).rejects.toThrow();
  });

  it.each(['copy', 'symlink'])(
    'installs locally with --mode %s and excludes it once',
    async (mode) => {
      const gitDir = await gitInit();
      const argv = ['--ci', '--scope', 'local', '--mode', mode];
      const first = await cli(argv);
      expect(first).toMatchObject({ code: 0, err: [] });
      expect(first.out).toContain(
        'excluded   /.claude/skills/configure-env in .git/info/exclude',
      );
      const target = join(root(), CLAUDE);
      if (mode === 'symlink') expect(await isLinkTo(target, SOURCE)).toBe(true);
      else expect(await tree(target)).toEqual(await tree(SOURCE));

      await cli([...argv, '--force']);
      const exclude = await readFile(join(gitDir, 'info', 'exclude'), 'utf8');
      expect(exclude).toBe('/.claude/skills/configure-env\n');
    },
  );

  it('appends to an existing exclude file, keeping its lines', async () => {
    const gitDir = await gitInit();
    await mkdir(join(gitDir, 'info'));
    await writeFile(join(gitDir, 'info', 'exclude'), '# git ls-files\n*.log');
    const result = await cli(['--ci', '--scope', 'local', '--agent', 'agents']);
    expect(result.code).toBe(0);
    expect(await readFile(join(gitDir, 'info', 'exclude'), 'utf8')).toBe(
      '# git ls-files\n*.log\n/.agents/skills/configure-env\n',
    );
  });

  it('excludes in the common git dir of a worktree', async () => {
    const main = join(root(), 'main');
    const gitDir = await gitInit(main);
    const worktreeGit = join(gitDir, 'worktrees', 'wt');
    await mkdir(worktreeGit, { recursive: true });
    await writeFile(join(worktreeGit, 'commondir'), '../..\n');
    const wt = join(root(), 'wt');
    await mkdir(wt);
    await writeFile(join(wt, '.git'), `gitdir: ${worktreeGit}\n`);

    const result = await cli(['--ci', '--scope', 'local', '--root', wt]);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect((await lstat(join(wt, CLAUDE))).isDirectory()).toBe(true);
    expect(await readFile(join(gitDir, 'info', 'exclude'), 'utf8')).toBe(
      '/.claude/skills/configure-env\n',
    );
  });

  it('refuses local outside a git repository', async () => {
    const result = await cli(['--ci', '--scope', 'local']);
    expect(result.code).toBe(2);
    expect(result.err[0]).toMatch(/--scope local needs a git repository/);
    await expect(lstat(join(root(), '.claude'))).rejects.toThrow();
  });

  it('keeps an existing target without --force', async () => {
    const target = join(root(), CLAUDE);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), 'mine\n');
    const result = await cli(['--ci']);
    expect(result.code).toBe(2);
    expect(result.err[0]).toBe(
      `configure-env: ${CLAUDE} exists; pass --force to replace it`,
    );
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('mine\n');
  });

  it('installs nothing when one of the targets exists', async () => {
    await mkdir(join(root(), AGENTS), { recursive: true });
    const result = await cli([
      '--ci',
      '--agent',
      'claude',
      '--agent',
      'agents',
    ]);
    expect(result.code).toBe(2);
    await expect(lstat(join(root(), CLAUDE))).rejects.toThrow();
  });

  it('replaces an existing target with --force', async () => {
    const target = join(root(), CLAUDE);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'stale.md'), 'old\n');
    const result = await cli(['--ci', '--force']);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([`installed  ${CLAUDE} (copy, replaced)`]);
    expect(await tree(target)).toEqual(await tree(SOURCE));
  });

  it('replaces a link with --force without following it', async () => {
    await cli(['--ci', '--mode', 'symlink']);
    const result = await cli(['--ci', '--mode', 'copy', '--force']);
    expect(result.code).toBe(0);
    const target = join(root(), CLAUDE);
    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(Object.keys(await tree(SOURCE))).toContain('SKILL.md');
  });

  it('leaves an identical link unchanged', async () => {
    await cli(['--ci', '--mode', 'symlink']);
    const result = await cli(['--ci', '--mode', 'symlink']);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect(result.out).toEqual([`unchanged  ${CLAUDE} (symlink)`]);
  });

  it.each([
    ['--scope', 'global', '--scope must be user, project or local'],
    ['--mode', 'hardlink', '--mode must be symlink or copy'],
    ['--agent', 'cursor', '--agent must be claude or agents'],
  ])('refuses %s %s', async (option, value, message) => {
    const result = await cli(['--ci', option, value]);
    expect(result.code).toBe(2);
    expect(result.err[0]).toBe(`configure-env: ${message}, got ${value}`);
  });

  it('prints one JSON document', async () => {
    await gitInit();
    const result = await cli([
      '--json',
      '--scope',
      'local',
      '--mode',
      'symlink',
      '--agent',
      'agents',
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0]!)).toEqual({
      command: 'install',
      ok: true,
      source: SOURCE,
      skills: [
        {
          agent: 'agents',
          scope: 'local',
          mode: 'symlink',
          path: join(root(), AGENTS),
          status: 'linked',
          replaced: false,
          exclude: {
            file: join(root(), '.git', 'info', 'exclude'),
            entry: '/.agents/skills/configure-env',
            status: 'added',
          },
        },
      ],
    });
  });

  it('prompts for the missing choices in a terminal', async () => {
    await gitInit();
    const { prompts, calls, logs } = scriptedPrompts({
      'Where should': 'local',
      'How should': 'symlink',
      'Which agents': ['claude', 'agents'],
    });
    const result = await cli([], { isTTY: true, prompts });
    expect(result.code).toBe(0);
    expect(calls.map((call) => call.kind)).toEqual([
      'select',
      'select',
      'multiselect',
    ]);
    expect(await isLinkTo(join(root(), CLAUDE), SOURCE)).toBe(true);
    expect(await isLinkTo(join(root(), AGENTS), SOURCE)).toBe(true);
    expect(logs.at(-1)).toMatch(/^outro: linked {5}\.claude/);
  });

  it('asks only for what the options leave out', async () => {
    const { prompts, calls } = scriptedPrompts();
    const result = await cli(['--scope', 'project', '--agent', 'claude'], {
      isTTY: true,
      prompts,
    });
    expect(result.code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'select',
      message: 'How should the skill be installed?',
    });
  });

  it('offers local only inside a git repository', async () => {
    const { prompts, calls } = scriptedPrompts();
    await cli([], { isTTY: true, prompts });
    const values = (calls[0]!.options as { value: string }[]).map(
      (option) => option.value,
    );
    expect(values).toEqual(['project', 'user']);
  });

  it('installs nothing when cancelled', async () => {
    const { prompts } = scriptedPrompts({ 'Where should': 'cancel' });
    const result = await cli([], { isTTY: true, prompts });
    expect(result.code).toBe(130);
    await expect(lstat(join(root(), '.claude'))).rejects.toThrow();
  });
});

describe('install', () => {
  it('needs a subject', async () => {
    const result = await run(['install', '--ci'], { cwd: root() });
    expect(result.code).toBe(2);
    expect(result.err).toEqual([
      'configure-env: install needs a subject: skill',
    ]);
  });

  it('refuses an unknown subject', async () => {
    const result = await run(['install', 'theme'], { cwd: root() });
    expect(result.code).toBe(2);
    expect(result.err).toEqual([
      'configure-env: unknown subject: theme',
      'configure-env install takes: skill',
    ]);
  });

  it.each([[['install', '--help']], [['install', 'skill', '-h']]])(
    '%j prints the help',
    async (argv) => {
      const result = await run(argv, { cwd: root() });
      expect(result.code).toBe(0);
      expect(result.out[0]).toMatch(/^Usage: configure-env install skill/);
    },
  );
});
