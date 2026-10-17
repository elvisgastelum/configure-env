import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

// Failures the file system is made to raise, to test what a failed install
// leaves behind; each test that sets one clears it after.
const faults = vi.hoisted(() => ({
  cp: undefined as Error | undefined,
  symlink: undefined as Error | undefined,
  rename: undefined as
    | ((from: string, to: string) => Error | undefined)
    | undefined,
  rm: undefined as ((path: string) => Error | undefined) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // A copy that fails half-way leaves its folder behind.
    cp: async (...args: Parameters<typeof actual.cp>) => {
      if (!faults.cp) return actual.cp(...args);
      await actual.mkdir(String(args[1]), { recursive: true });
      throw faults.cp;
    },
    symlink: async (...args: Parameters<typeof actual.symlink>) => {
      if (faults.symlink) throw faults.symlink;
      return actual.symlink(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const fault = faults.rename?.(String(args[0]), String(args[1]));
      if (fault) throw fault;
      return actual.rename(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      const fault = faults.rm?.(String(args[0]));
      if (fault) throw fault;
      return actual.rm(...args);
    },
  };
});
afterEach(() => {
  faults.cp = faults.symlink = faults.rename = faults.rm = undefined;
});

const noSpace = () =>
  Object.assign(new Error('no space left'), { code: 'ENOSPC' });

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

/** Makes `gitDir` a git dir as git checks one: HEAD, objects and refs. */
async function makeGitDir(gitDir: string) {
  await mkdir(join(gitDir, 'objects'), { recursive: true });
  await mkdir(join(gitDir, 'refs'), { recursive: true });
  await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  return gitDir;
}

/** Makes the root a git repository; returns its git dir. */
const gitInit = (dir = root()) => makeGitDir(join(dir, '.git'));

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

      const second = await cli([...argv, '--force']);
      expect(second).toMatchObject({ code: 0, err: [] });
      expect(second.out).toEqual([`unchanged  ${CLAUDE} (${mode})`]);
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
    await writeFile(join(worktreeGit, 'HEAD'), 'ref: refs/heads/wt\n');
    const wt = join(root(), 'wt');
    await mkdir(wt);
    await writeFile(join(wt, '.git'), `gitdir: ${worktreeGit}\n`);
    // git names the worktree's .git file back from its git dir.
    await writeFile(join(worktreeGit, 'gitdir'), `${join(wt, '.git')}\n`);

    const result = await cli(['--ci', '--scope', 'local', '--root', wt]);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect((await lstat(join(wt, CLAUDE))).isDirectory()).toBe(true);
    expect(await readFile(join(gitDir, 'info', 'exclude'), 'utf8')).toBe(
      '/.claude/skills/configure-env\n',
    );
  });

  it('excludes in the git dir of a submodule', async () => {
    const gitDir = await gitInit();
    const moduleGit = await makeGitDir(join(gitDir, 'modules', 'sub'));
    // A submodule's git dir names its work tree in its config.
    await writeFile(
      join(moduleGit, 'config'),
      '[core]\n\tworktree = ../../../sub\n',
    );
    const sub = join(root(), 'sub');
    await mkdir(sub);
    await writeFile(join(sub, '.git'), 'gitdir: ../.git/modules/sub\n');

    const result = await cli(['--ci', '--scope', 'local', '--root', sub]);
    expect(result).toMatchObject({ code: 0, err: [] });
    expect((await lstat(join(sub, CLAUDE))).isDirectory()).toBe(true);
    expect(await readFile(join(moduleGit, 'info', 'exclude'), 'utf8')).toBe(
      '/.claude/skills/configure-env\n',
    );
  });

  describe('a repository made with git init --separate-git-dir', () => {
    // As git writes it: a .git file naming a git dir elsewhere, which names
    // no work tree back.
    const separate = async () => {
      const gitDir = await makeGitDir(join(home.dir, 'repo.git'));
      await writeFile(
        join(gitDir, 'config'),
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
      await writeFile(join(root(), '.git'), `gitdir: ${gitDir}\n`);
      return gitDir;
    };

    it('installs locally and excludes in the separate git dir', async () => {
      const gitDir = await separate();
      const result = await cli(['--ci', '--scope', 'local']);
      expect(result).toMatchObject({ code: 0, err: [] });
      expect((await lstat(join(root(), CLAUDE))).isDirectory()).toBe(true);
      expect(await readFile(join(gitDir, 'info', 'exclude'), 'utf8')).toBe(
        '/.claude/skills/configure-env\n',
      );
    });

    it('installs project at the top level from a subdirectory', async () => {
      await separate();
      const app = join(root(), 'packages', 'app');
      await mkdir(app, { recursive: true });
      const result = await cli(['--ci', '--scope', 'project', '--root', app]);
      expect(result).toMatchObject({ code: 0, err: [] });
      expect((await lstat(join(root(), CLAUDE))).isDirectory()).toBe(true);
      await expect(lstat(join(app, '.claude'))).rejects.toThrow();
    });
  });

  it('refuses local for a .git folder that is not a git dir', async () => {
    await mkdir(join(root(), '.git'));
    await writeFile(join(root(), '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const result = await cli(['--ci', '--scope', 'local']);
    expect(result.code).toBe(2);
    expect(result.err[0]).toBe(
      `configure-env: --scope local needs a git repository: ${join(root(), '.git')} does not lead to one`,
    );
  });

  describe('a .git file that does not lead back to it', () => {
    /** A folder outside the project, for a .git file to point at. */
    const outside = () => join(home.dir, 'elsewhere');

    const crafted: [string, () => Promise<void>][] = [
      ['a folder without HEAD', async () => {}],
      [
        'a folder with only HEAD',
        async () => {
          await writeFile(join(outside(), 'HEAD'), 'ref: refs/heads/main\n');
        },
      ],
      [
        'a git dir without HEAD',
        async () => {
          await makeGitDir(outside());
          await rm(join(outside(), 'HEAD'));
        },
      ],
      [
        'a worktree git dir that names another .git',
        async () => {
          await makeGitDir(outside());
          await writeFile(join(outside(), 'gitdir'), '/somewhere/else/.git\n');
        },
      ],
      [
        'a submodule git dir whose work tree is elsewhere',
        async () => {
          await makeGitDir(outside());
          await writeFile(
            join(outside(), 'config'),
            '[core]\n\tworktree = /somewhere/else\n',
          );
        },
      ],
      [
        'a worktree whose commondir is not a git dir',
        async () => {
          // The worktree git dir would pass on its own: its commondir is
          // what holds objects and refs.
          await makeGitDir(outside());
          await writeFile(
            join(outside(), 'gitdir'),
            `${join(root(), '.git')}\n`,
          );
          await mkdir(join(outside(), 'common'));
          await writeFile(join(outside(), 'common', 'HEAD'), 'ref: x\n');
          await writeFile(join(outside(), 'commondir'), 'common\n');
        },
      ],
    ];

    it.each(crafted)('refuses local for %s', async (_, make) => {
      await mkdir(outside());
      await make();
      await writeFile(join(root(), '.git'), `gitdir: ${outside()}\n`);
      const result = await cli(['--ci', '--scope', 'local']);
      expect(result.code).toBe(2);
      expect(result.err[0]).toBe(
        `configure-env: --scope local needs a git repository: ${join(root(), '.git')} does not lead to one`,
      );
      await expect(lstat(join(outside(), 'info'))).rejects.toThrow();
      await expect(lstat(join(outside(), 'common', 'info'))).rejects.toThrow();
      await expect(lstat(join(root(), '.claude'))).rejects.toThrow();
    });

    // Like a folder in no repository: project installs at the root, not at
    // the folder holding the .git file, and never goes further up.
    it.each(crafted)('installs project at the root for %s', async (_, make) => {
      await mkdir(outside());
      await make();
      await writeFile(join(root(), '.git'), `gitdir: ${outside()}\n`);
      const app = join(root(), 'packages', 'app');
      await mkdir(app, { recursive: true });
      const result = await cli(['--ci', '--scope', 'project', '--root', app]);
      expect(result).toMatchObject({ code: 0, err: [] });
      expect((await lstat(join(app, CLAUDE))).isDirectory()).toBe(true);
      await expect(lstat(join(root(), '.claude'))).rejects.toThrow();
    });
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

  it.each([
    ['copy', 'the copy', () => (faults.cp = noSpace())],
    ['symlink', 'the link', () => (faults.symlink = noSpace())],
    [
      'copy',
      'the swap',
      () => {
        // Only the new skill's rename into place: putting the old one back
        // must work.
        let failed = false;
        faults.rename = (from, to) => {
          if (failed || basename(to) !== 'configure-env') return undefined;
          failed = true;
          return noSpace();
        };
      },
    ],
  ])(
    'keeps the old target when --force --mode %s fails at %s',
    async (mode, _, fail) => {
      const target = join(root(), CLAUDE);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'stale.md'), 'old\n');
      fail();
      const result = await cli(['--ci', '--force', '--mode', mode]);
      expect(result).toMatchObject({ code: 1, out: [] });
      expect(result.err).toEqual([
        `configure-env: cannot install ${CLAUDE}: ENOSPC`,
      ]);
      expect(await tree(target)).toEqual({
        'stale.md': Buffer.from('old\n').toString('base64'),
      });
      expect(await readdir(join(root(), '.claude', 'skills'))).toEqual([
        'configure-env',
      ]);
    },
  );

  describe('when the old target cannot be put back', () => {
    // Every rename into the target fails: the new skill's and the old one's.
    const stranded = async () => {
      const target = join(root(), CLAUDE);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'stale.md'), 'old\n');
      faults.rename = (_, to) =>
        basename(to) === 'configure-env' ? noSpace() : undefined;
    };
    /** The hidden siblings the old skill was moved aside to. */
    const aside = async () =>
      (await readdir(join(root(), '.claude', 'skills'))).filter((name) =>
        name.startsWith('.configure-env-'),
      );

    it('reports the first failure and where the old skill is', async () => {
      await stranded();
      const result = await cli(['--ci', '--force']);
      expect(result).toMatchObject({ code: 1, out: [] });
      const [left] = await aside();
      expect(await aside()).toHaveLength(1);
      const shown = `.claude/skills/${left}`;
      expect(result.err).toEqual([
        `configure-env: cannot install ${CLAUDE}: ENOSPC`,
        `the previous skill was left at ${shown}; move it back to ${CLAUDE}`,
      ]);
      expect(await tree(join(root(), shown))).toEqual({
        'stale.md': Buffer.from('old\n').toString('base64'),
      });
    });

    it('names it in the JSON error', async () => {
      await stranded();
      const result = await cli(['--json', '--force']);
      expect(result).toMatchObject({ code: 1, err: [] });
      const [left] = await aside();
      expect(JSON.parse(result.out[0]!).errors).toEqual([
        {
          kind: 'file',
          path: CLAUDE,
          message: `cannot install ${CLAUDE}: ENOSPC; the previous skill was left at .claude/skills/${left}; move it back to ${CLAUDE}`,
        },
      ]);
    });
  });

  describe('when the replaced skill cannot be removed', () => {
    const leftover = async () => {
      const target = join(root(), CLAUDE);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'stale.md'), 'old\n');
      faults.rm = (path) =>
        basename(path).startsWith('.configure-env-')
          ? Object.assign(new Error('denied'), { code: 'EACCES' })
          : undefined;
    };
    const warning = (left: string) =>
      `the previous skill was left at .claude/skills/${left}; delete it, or an agent may load it as a second skill`;
    const aside = async () =>
      (await readdir(join(root(), '.claude', 'skills'))).filter((name) =>
        name.startsWith('.configure-env-'),
      );

    it('installs and warns with its path', async () => {
      await leftover();
      const result = await cli(['--ci', '--force']);
      expect(result.code).toBe(0);
      expect(result.out).toEqual([`installed  ${CLAUDE} (copy, replaced)`]);
      const left = await aside();
      expect(left).toHaveLength(1);
      expect(result.err).toEqual([
        `configure-env: warning: ${warning(left[0]!)}`,
      ]);
      expect(await tree(join(root(), CLAUDE))).toEqual(await tree(SOURCE));
    });

    it('lists the warning in the JSON document', async () => {
      await leftover();
      const result = await cli(['--json', '--force']);
      expect(result).toMatchObject({ code: 0, err: [] });
      const [left] = await aside();
      const document = JSON.parse(result.out[0]!);
      expect(document).toMatchObject({ ok: true, warnings: [warning(left!)] });
      expect(document.skills).toHaveLength(1);
    });
  });

  it('leaves no half-written copy when the copy fails', async () => {
    faults.cp = noSpace();
    const result = await cli(['--ci']);
    expect(result.code).toBe(1);
    expect(await readdir(join(root(), '.claude', 'skills'))).toEqual([]);
  });

  it('leaves no temporary folder after replacing', async () => {
    await cli(['--ci', '--mode', 'symlink']);
    const result = await cli(['--ci', '--mode', 'copy', '--force']);
    expect(result.code).toBe(0);
    expect(await readdir(join(root(), '.claude', 'skills'))).toEqual([
      'configure-env',
    ]);
  });

  it('reports the agents installed before one that fails', async () => {
    await gitInit();
    // A file where the folder should be: placing the second agent fails.
    await writeFile(join(root(), '.agents'), '');
    const result = await cli([
      '--ci',
      '--scope',
      'local',
      '--agent',
      'claude',
      '--agent',
      'agents',
    ]);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([
      `installed  ${CLAUDE} (copy)`,
      'excluded   /.claude/skills/configure-env in .git/info/exclude',
    ]);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toMatch(
      /^configure-env: cannot install \.agents\/skills\/configure-env: E[A-Z]+$/,
    );
    expect(await tree(join(root(), CLAUDE))).toEqual(await tree(SOURCE));
    // Only the installed skill is excluded.
    expect(
      await readFile(join(root(), '.git', 'info', 'exclude'), 'utf8'),
    ).toBe('/.claude/skills/configure-env\n');
  });

  it('prints one failed JSON document holding the installed agents', async () => {
    await writeFile(join(root(), '.agents'), '');
    const result = await cli([
      '--json',
      '--agent',
      'claude',
      '--agent',
      'agents',
    ]);
    expect(result).toMatchObject({ code: 1, err: [] });
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0]!)).toEqual({
      command: 'install',
      ok: false,
      source: SOURCE,
      skills: [
        {
          agent: 'claude',
          scope: 'project',
          mode: 'copy',
          path: join(root(), CLAUDE),
          status: 'installed',
          replaced: false,
        },
      ],
      errors: [
        {
          kind: 'file',
          path: AGENTS,
          message: expect.stringMatching(
            /^cannot install \.agents\/skills\/configure-env: E[A-Z]+$/,
          ),
        },
      ],
    });
  });

  it('reports the installed skill when the exclude file cannot be written', async () => {
    const gitDir = await gitInit();
    // A file where the info folder should be.
    await writeFile(join(gitDir, 'info'), '');
    const result = await cli([
      '--ci',
      '--scope',
      'local',
      '--agent',
      'claude',
      '--agent',
      'agents',
    ]);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([`installed  ${CLAUDE} (copy)`]);
    expect(result.err).toEqual([
      `configure-env: cannot update ${join(gitDir, 'info', 'exclude')}: ENOTDIR`,
      `${CLAUDE} was installed; add /.claude/skills/configure-env to it yourself`,
    ]);
    // The run stops there: the next agent is not installed.
    await expect(lstat(join(root(), AGENTS))).rejects.toThrow();
  });

  it('prints a failed JSON document when the exclude file cannot be written', async () => {
    const gitDir = await gitInit();
    await writeFile(join(gitDir, 'info'), '');
    const result = await cli(['--json', '--scope', 'local']);
    expect(result).toMatchObject({ code: 1, err: [] });
    expect(result.out).toHaveLength(1);
    const file = join(gitDir, 'info', 'exclude');
    expect(JSON.parse(result.out[0]!)).toEqual({
      command: 'install',
      ok: false,
      source: SOURCE,
      skills: [
        {
          agent: 'claude',
          scope: 'local',
          mode: 'copy',
          path: join(root(), CLAUDE),
          status: 'installed',
          replaced: false,
        },
      ],
      errors: [
        {
          kind: 'file',
          path: relative(root(), file),
          message: `cannot update ${file}: ENOTDIR; ${CLAUDE} was installed; add /.claude/skills/configure-env to it yourself`,
        },
      ],
    });
  });

  describe('an existing copy', () => {
    const target = () => join(root(), CLAUDE);
    /** What a rewrite would change: the folder's and a file's identity. */
    const identity = async () =>
      Promise.all(
        [target(), join(target(), 'SKILL.md')].map(async (path) => {
          const { ino, mtimeMs } = await stat(path);
          return { ino, mtimeMs };
        }),
      );

    it.each([[[]], [['--force']]])(
      'is left unchanged when identical, with %j',
      async (extra) => {
        await cli(['--ci']);
        const before = await identity();
        const result = await cli(['--ci', ...extra]);
        expect(result).toMatchObject({ code: 0, err: [] });
        expect(result.out).toEqual([`unchanged  ${CLAUDE} (copy)`]);
        expect(await identity()).toEqual(before);
        expect(await readdir(join(root(), '.claude', 'skills'))).toEqual([
          'configure-env',
        ]);
      },
    );

    it.each([
      [
        'a modified file',
        () => writeFile(join(target(), 'SKILL.md'), 'mine\n'),
      ],
      ['an extra file', () => writeFile(join(target(), 'notes.md'), 'x\n')],
      ['a missing file', () => rm(join(target(), 'SKILL.md'))],
    ])('is kept without --force when it has %s', async (_, change) => {
      await cli(['--ci']);
      await change();
      const result = await cli(['--ci']);
      expect(result.code).toBe(2);
      expect(result.err[0]).toBe(
        `configure-env: ${CLAUDE} exists; pass --force to replace it`,
      );
    });
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
