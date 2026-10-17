import { spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { fixGitignore, gitignoreProblems } from './ignore-check.ts';
import { DEFAULT_STATE_PATH } from './state.ts';
import { useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const root = () => temp.dirs.root;
const stateDir = () => join(root(), '.configure-env');
const statePath = () => join(root(), DEFAULT_STATE_PATH);
const read = (path: string) => readFile(join(root(), path), 'utf8');

const STATE_ENTRIES = [
  'state.db',
  'state.db-journal',
  'state.db-wal',
  'state.db-shm',
  'state.json',
];

/** Makes the root a git work tree, as `git init` does. */
function gitInit() {
  const result = spawnSync('git', ['init', '-q'], { cwd: root() });
  if (result.status !== 0) throw new Error(String(result.stderr));
}

const problems = (files: string[] = []) =>
  gitignoreProblems({ root: root(), files, statePath: statePath() });

describe('gitignoreProblems', () => {
  it('finds none without a state directory, outside a git work tree', async () => {
    expect(await problems(['.env'])).toEqual([]);
  });

  it('reports a state directory without a .gitignore, with every entry it needs', async () => {
    await mkdir(stateDir());
    expect(await problems()).toEqual([
      {
        severity: 'error',
        code: 'state-not-ignored',
        path: '.configure-env',
        gitignore: '.configure-env/.gitignore',
        entries: STATE_ENTRIES,
        message: 'no .gitignore keeps the state out of git',
      },
    ]);
  });

  it('reports only the entries its .gitignore lacks', async () => {
    await mkdir(stateDir());
    await writeFile(
      join(stateDir(), '.gitignore'),
      'state.db\n/state.db-journal\nstate.db-shm\n',
    );
    expect(await problems()).toEqual([
      expect.objectContaining({
        code: 'state-not-ignored',
        entries: ['state.db-wal', 'state.json'],
        message: 'its .gitignore does not ignore state.db-wal, state.json',
      }),
    ]);
  });

  it('accepts a .gitignore that ignores every file with *', async () => {
    await mkdir(stateDir());
    await writeFile(join(stateDir(), '.gitignore'), '*\n');
    expect(await problems()).toEqual([]);
  });

  it('marks a state .gitignore that is a symlink as one it will not fix', async () => {
    await mkdir(stateDir());
    await writeFile(join(root(), 'elsewhere'), '');
    await symlink(join(root(), 'elsewhere'), join(stateDir(), '.gitignore'));
    expect(await problems()).toEqual([
      expect.objectContaining({
        code: 'state-not-ignored',
        blocked: 'symlink',
      }),
    ]);
  });

  it('reports an env file git does not ignore, in a git work tree', async () => {
    gitInit();
    await writeFile(join(root(), '.gitignore'), 'secret.env\n');
    expect(await problems(['.env', 'secret.env', 'config/app.env'])).toEqual([
      {
        severity: 'error',
        code: 'file-not-ignored',
        path: '.env',
        gitignore: '.gitignore',
        entries: ['/.env'],
        message: 'not git-ignored; its values could be committed',
      },
      expect.objectContaining({
        path: 'config/app.env',
        entries: ['/config/app.env'],
      }),
    ]);
  });

  it('checks no env file outside a git work tree', async () => {
    await writeFile(join(root(), '.gitignore'), '');
    expect(await problems(['.env'])).toEqual([]);
  });

  it('marks a root .gitignore that is a symlink as one it will not fix', async () => {
    gitInit();
    await writeFile(join(root(), 'elsewhere'), '');
    await symlink(join(root(), 'elsewhere'), join(root(), '.gitignore'));
    expect(await problems(['.env'])).toEqual([
      expect.objectContaining({ code: 'file-not-ignored', blocked: 'symlink' }),
    ]);
  });

  it('escapes what git would read as a pattern', async () => {
    gitInit();
    expect(await problems(['#odd[1].env'])).toEqual([
      expect.objectContaining({ entries: ['/\\#odd\\[1\\].env'] }),
    ]);
  });
});

describe('fixGitignore', () => {
  it('writes the state .gitignore and the env files to the root .gitignore, then finds none', async () => {
    gitInit();
    await mkdir(stateDir());
    await writeFile(join(root(), '.gitignore'), 'node_modules/');
    const fixes = await fixGitignore(root(), await problems(['.env']));
    expect(fixes).toEqual({
      fixed: [
        {
          gitignore: '.configure-env/.gitignore',
          created: true,
          added: STATE_ENTRIES,
        },
        { gitignore: '.gitignore', created: false, added: ['/.env'] },
      ],
      skipped: [],
    });
    expect(await read('.configure-env/.gitignore')).toBe(
      [
        '# The state of configure-env on this machine; never commit it.',
        ...STATE_ENTRIES,
        '',
      ].join('\n'),
    );
    expect(await read('.gitignore')).toBe('node_modules/\n/.env\n');
    expect(await problems(['.env'])).toEqual([]);
  });

  it('appends only the missing state entries, and creates a root .gitignore', async () => {
    gitInit();
    await mkdir(stateDir());
    await writeFile(join(stateDir(), '.gitignore'), 'mine\nstate.db\n');
    await fixGitignore(root(), await problems(['.env']));
    expect(await read('.configure-env/.gitignore')).toBe(
      ['mine', 'state.db', ...STATE_ENTRIES.slice(1), ''].join('\n'),
    );
    expect(await read('.gitignore')).toBe('/.env\n');
  });

  it('skips a problem whose .gitignore is not one inside the root', async () => {
    const problem = {
      severity: 'error' as const,
      code: 'file-not-ignored' as const,
      path: '.env',
      entries: ['/.env'],
      message: 'not git-ignored; its values could be committed',
    };
    const outside = [
      { ...problem, gitignore: '../.gitignore' },
      { ...problem, gitignore: 'env.schema.json' },
    ];
    expect(await fixGitignore(root(), outside)).toEqual({
      fixed: [],
      skipped: outside,
    });
  });

  it('skips a problem it may not fix, writing nothing for it', async () => {
    await mkdir(stateDir());
    await writeFile(join(root(), 'elsewhere'), 'kept\n');
    await symlink(join(root(), 'elsewhere'), join(stateDir(), '.gitignore'));
    const found = await problems();
    expect(await fixGitignore(root(), found)).toEqual({
      fixed: [],
      skipped: found,
    });
    expect(await read('elsewhere')).toBe('kept\n');
  });
});
