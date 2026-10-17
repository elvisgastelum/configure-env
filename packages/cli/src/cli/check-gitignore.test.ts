import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject();
const root = () => dirs.root;
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: root(), ...options });
const read = (path: string) => readFile(join(root(), path), 'utf8');
const TOKEN = ['--set', 'TOKEN=abcdefghij'];
const NOT_IGNORED = 'not git-ignored; its values could be committed';

/** A git work tree whose .gitignore ignores every env file but local.env. */
beforeEach(async () => {
  const result = spawnSync('git', ['init', '-q'], { cwd: root() });
  if (result.status !== 0) throw new Error(String(result.stderr));
  expect((await cli(['apply', '--ci', ...TOKEN])).code).toBe(0);
  await writeFile(join(root(), '.gitignore'), '/config/app.env\n/shared.env');
});

describe('check and git', () => {
  it('reports an env file git does not ignore as an error', async () => {
    const r = await cli(['check', '--ci']);
    expect(r).toMatchObject({ code: 1, err: [] });
    expect(r.out).toEqual([
      'config/app.env: ok',
      'shared.env: ok',
      'local.env: ok',
      `local.env: ${NOT_IGNORED} (check --fix adds /local.env to .gitignore)`,
      '1 error, 0 warnings in 1 file',
    ]);
    expect(await read('.gitignore')).toBe('/config/app.env\n/shared.env');
  });

  it('reports a state folder without its .gitignore', async () => {
    await writeFile(join(root(), '.gitignore'), '*.env\n');
    await mkdir(join(root(), '.configure-env'), { recursive: true });
    await rm(join(root(), '.configure-env', '.gitignore'), { force: true });
    const r = await cli(['check', '--ci']);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      '.configure-env: no .gitignore keeps the state out of git (check --fix adds state.db, state.db-journal, state.db-wal, state.db-shm, state.json to .configure-env/.gitignore)',
    );
  });

  it('fixes them with --fix, saying what it added, and exits 0', async () => {
    await mkdir(join(root(), '.configure-env'), { recursive: true });
    await rm(join(root(), '.configure-env', '.gitignore'), { force: true });
    const r = await cli(['check', '--ci', '--fix']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toEqual([
      'Created .configure-env/.gitignore with state.db, state.db-journal, state.db-wal, state.db-shm, state.json',
      'Added /local.env to .gitignore',
      'config/app.env: ok',
      'shared.env: ok',
      'local.env: ok',
      'Everything is current.',
    ]);
    expect(await read('.gitignore')).toBe(
      '/config/app.env\n/shared.env\n/local.env\n',
    );
    expect((await cli(['check', '--ci'])).code).toBe(0);
  });

  it('reports the fixes in --json, with the report after them', async () => {
    const r = await cli(['check', '--json', '--fix']);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out[0]!);
    expect(report).toMatchObject({
      command: 'check',
      ok: true,
      gitignore: [],
      fixed: [
        { gitignore: '.gitignore', created: false, added: ['/local.env'] },
      ],
    });
  });

  it('reports the git-ignore problems in --json', async () => {
    const r = await cli(['check', '--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.out[0]!);
    expect(report.gitignore).toEqual([
      {
        severity: 'error',
        code: 'file-not-ignored',
        path: 'local.env',
        gitignore: '.gitignore',
        entries: ['/local.env'],
        message: NOT_IGNORED,
      },
    ]);
    expect(report).not.toHaveProperty('fixed');
    expect(report.summary).toMatchObject({ errors: 1 });
  });

  it('never writes through a .gitignore that is a symlink', async () => {
    await writeFile(
      join(root(), 'elsewhere'),
      '/config/app.env\n/shared.env\n',
    );
    await rm(join(root(), '.gitignore'));
    await symlink(join(root(), 'elsewhere'), join(root(), '.gitignore'));
    const r = await cli(['check', '--ci', '--fix']);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `local.env: ${NOT_IGNORED} (.gitignore is a symlink; add /local.env to it yourself)`,
    );
    expect(await read('elsewhere')).toBe('/config/app.env\n/shared.env\n');
  });

  it('asks which to fix in a terminal, every one selected first', async () => {
    const { prompts, calls, logs } = scriptedPrompts();
    const r = await cli(['check'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        kind: 'multiselect',
        message: 'Fix these git-ignore problems?',
        options: [
          {
            value: 0,
            label: 'local.env',
            hint: 'add /local.env to .gitignore',
          },
        ],
        initialValues: [0],
        required: false,
      }),
    ]);
    expect(logs).toContain('success: Added /local.env to .gitignore');
    expect(logs.at(-1)).toBe('outro: Everything is current.');
    expect(await read('.gitignore')).toContain('/local.env');
  });

  it('writes nothing when the person selects none, or cancels', async () => {
    for (const answer of [[], 'cancel']) {
      const { prompts, logs } = scriptedPrompts({ 'git-ignore': answer });
      const r = await cli(['check'], { isTTY: true, prompts });
      expect(r.code).toBe(1);
      expect(logs.at(-1)).toBe('outro: 1 error, 0 warnings in 1 file');
      expect(await read('.gitignore')).toBe('/config/app.env\n/shared.env');
    }
  });

  it('fixes without asking in a terminal with --fix', async () => {
    const { prompts, calls } = scriptedPrompts();
    const r = await cli(['check', '--fix'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls).toEqual([]);
  });
});
