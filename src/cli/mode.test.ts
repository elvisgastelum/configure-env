// apply brings an existing file to its schema mode with a chmod only, and
// never loosens one.

import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const SECRET = 'hunter2-secret-value';

const dirs = useProject({
  version: 1,
  variables: {
    API_TOKEN: { type: 'string', secret: true, required: true },
    PORT: { type: 'port', default: 8080 },
  },
  files: [
    { path: '.env.example', policy: 'merge', variables: ['PORT'] },
    {
      path: 'config.env.template',
      policy: 'merge',
      mode: '640',
      variables: ['PORT'],
    },
    { path: '.env', policy: 'create-only', mode: '600', variables: '*' },
    {
      path: 'apps/api/.env',
      policy: 'create-only',
      mode: '600',
      variables: '*',
    },
    { path: 'gen.env', policy: 'generate', mode: '600', variables: ['PORT'] },
    { path: 'merge.env', policy: 'merge', mode: '640', variables: ['PORT'] },
  ],
});
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const path = (name: string) => join(dirs.root, name);
const modeOf = async (name: string) => (await stat(path(name))).mode & 0o777;
const CONTENT = `API_TOKEN=${SECRET}\nPORT=8080\n`;

/** Writes `name` with `content`, then gives it `mode`, whatever the umask. */
async function seed(name: string, mode: number, content = CONTENT) {
  await mkdir(join(path(name), '..'), { recursive: true });
  await writeFile(path(name), content);
  await chmod(path(name), mode);
}

const noSecret = (...runs: { out: string[]; err: string[] }[]) =>
  expect(runs.flatMap((r) => [...r.out, ...r.err]).join('\n')).not.toContain(
    SECRET,
  );

describe('apply fixes mode drift', () => {
  it('chmods an existing create-only file, keeping its bytes', async () => {
    await seed('.env', 0o644);
    const before = await stat(path('.env'));
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: mode fixed (644 → 600)'],
      err: [],
    });
    const after = await stat(path('.env'));
    expect(after.mode & 0o777).toBe(0o600);
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(await readFile(path('.env'), 'utf8')).toBe(CONTENT);
    const again = await cli(['apply', '--ci', '--file', '.env']);
    expect(again).toMatchObject({ code: 0, out: ['.env: skipped (exists)'] });
    noSecret(r, again);
  });

  it('reports the fix with --json', async () => {
    await seed('.env', 0o644);
    await seed('apps/api/.env', 0o644);
    const r = await cli([
      'apply',
      '--ci',
      '--json',
      '--file',
      '.env',
      '--file',
      'apps/api/.env',
    ]);
    expect(r.code).toBe(0);
    const document = JSON.parse(r.out[0]!);
    expect(document).toMatchObject({ command: 'apply', ok: true, errors: [] });
    for (const file of document.files)
      expect(file).toEqual({
        path: file.path,
        policy: 'create-only',
        action: 'mode',
        status: 'mode fixed (644 → 600)',
        addedKeys: [],
        prunedKeys: [],
        written: false,
        mode: { from: '644', to: '600' },
      });
    noSecret(r);
  });

  it('chmods a current generate or merge file without rewriting it', async () => {
    const files = ['--file', 'gen.env', '--file', 'merge.env'];
    expect((await cli(['apply', '--ci', ...files])).code).toBe(0);
    await chmod(path('gen.env'), 0o644);
    await chmod(path('merge.env'), 0o644);
    const before = await Promise.all(
      ['gen.env', 'merge.env'].map((f) => stat(path(f))),
    );
    const r = await cli(['apply', '--ci', ...files]);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'gen.env: mode fixed (644 → 600)',
        'merge.env: mode fixed (644 → 640)',
      ],
    });
    const after = await Promise.all(
      ['gen.env', 'merge.env'].map((f) => stat(path(f))),
    );
    expect(after.map((s) => s.mode & 0o777)).toEqual([0o600, 0o640]);
    expect(after.map((s) => [s.ino, s.mtimeMs])).toEqual(
      before.map((s) => [s.ino, s.mtimeMs]),
    );
  });

  it('carries the mode change of a file it rewrites', async () => {
    await seed('merge.env', 0o644, '');
    const r = await cli(['apply', '--ci', '--json', '--file', 'merge.env']);
    expect(JSON.parse(r.out[0]!).files[0]).toMatchObject({
      action: 'update',
      status: 'added keys: PORT',
      written: true,
      mode: { from: '644', to: '640' },
    });
    expect(await modeOf('merge.env')).toBe(0o640);
  });

  it('never loosens a mode, and exits 1', async () => {
    await seed('.env', 0o400);
    await seed('apps/api/.env', 0o644);
    const both = ['--file', '.env', '--file', 'apps/api/.env'];
    const r = await cli(['apply', '--ci', ...both]);
    expect(r).toMatchObject({
      code: 1,
      out: [
        '.env: mode not loosened (400, schema says 600)',
        'apps/api/.env: mode fixed (644 → 600)',
      ],
    });
    expect(await modeOf('.env')).toBe(0o400);
    expect(await modeOf('apps/api/.env')).toBe(0o600);
    const json = await cli(['apply', '--ci', '--json', ...both]);
    expect(json.code).toBe(1);
    const document = JSON.parse(json.out[0]!);
    expect(document).toMatchObject({
      ok: false,
      errors: [
        {
          kind: 'file',
          path: '.env',
          message: 'mode not loosened (400, schema says 600)',
        },
      ],
    });
    expect(document.files[0]).toMatchObject({
      action: 'skip',
      reason: 'loosens',
      status: 'mode not loosened (400, schema says 600)',
      written: false,
    });
    const check = await cli(['check', '--ci', '--file', '.env']);
    expect(check.code).toBe(1);
    expect(check.out).toContain(
      '.env: mode 400, expected 600 (apply never adds a permission; chmod it by hand)',
    );
    noSecret(r, json, check);
  });

  it('exits 1 when the only file of the run would loosen', async () => {
    await seed('.env', 0o400);
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 1,
      out: ['.env: mode not loosened (400, schema says 600)'],
      err: [],
    });
    const json = await cli(['apply', '--ci', '--json', '--file', '.env']);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      ok: false,
      errors: [
        {
          kind: 'file',
          path: '.env',
          message: 'mode not loosened (400, schema says 600)',
        },
      ],
      files: [{ path: '.env', action: 'skip', reason: 'loosens' }],
    });
    expect(await modeOf('.env')).toBe(0o400);
  });

  it('warns about a loosening file in the terminal and exits 1', async () => {
    await seed('.env', 0o400);
    const { prompts, calls, logs } = scriptedPrompts({
      'Which files': ['.env'],
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(1);
    const picker = calls[0] as unknown as {
      options: { value: string; hint: string }[];
    };
    expect(picker.options.find((o) => o.value === '.env')!.hint).toBe(
      'create-only; mode not loosened (400, schema says 600)',
    );
    expect(logs).toContain(
      'warn: .env: mode not loosened (400, schema says 600)',
    );
    expect(logs.at(-1)).toBe('outro: Nothing to write.');
    expect(await modeOf('.env')).toBe(0o400);
  });

  it('fixes a template only when it declares a mode', async () => {
    await seed('.env.example', 0o664, 'PORT=8080\n');
    await seed('config.env.template', 0o644, 'PORT=8080\n');
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      '.env.example',
      '--file',
      'config.env.template',
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: [
        '.env.example: unchanged',
        'config.env.template: mode fixed (644 → 640)',
      ],
    });
    expect(await modeOf('.env.example')).toBe(0o664);
    expect(await modeOf('config.env.template')).toBe(0o640);
  });

  it('refuses a symlink', async () => {
    await seed('outside.env', 0o644);
    await symlink(path('outside.env'), path('.env'));
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      '.env: skipped (refused: is a symlink; refusing to write through it)',
    ]);
    expect(await modeOf('outside.env')).toBe(0o644);
  });

  it('shows the fix in the terminal, asking for no value', async () => {
    await seed('.env', 0o644);
    const { prompts, calls, logs } = scriptedPrompts({
      'Which files': ['.env'],
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    const picker = calls[0] as unknown as {
      options: { value: string; hint: string }[];
      initialValues: string[];
    };
    expect(picker.options.find((o) => o.value === '.env')!.hint).toBe(
      'create-only; mode 644, expected 600',
    );
    expect(picker.initialValues).toContain('.env');
    expect(calls.map((c) => c.kind)).toEqual(['multiselect', 'confirm']);
    expect(logs).toContain('note: Plan: .env: fix mode (644 → 600)');
    expect(logs.at(-1)).toBe('outro: .env: mode fixed (644 → 600)');
    expect(await modeOf('.env')).toBe(0o600);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('passes check after the fix, which check hints at', async () => {
    await seed('.env', 0o644);
    const before = await cli(['check', '--ci', '--file', '.env']);
    expect(before).toMatchObject({
      code: 1,
      out: [
        '.env: current',
        '.env: mode 644, expected 600 (run configure-env apply to fix it)',
      ],
    });
    const json = await cli(['check', '--ci', '--json', '--file', '.env']);
    expect(JSON.parse(json.out[0]!).files[0].mode).toEqual({
      actual: '644',
      expected: '600',
    });
    expect((await cli(['apply', '--ci', '--file', '.env'])).code).toBe(0);
    const after = await cli(['check', '--ci', '--file', '.env']);
    expect(after).toMatchObject({ code: 0, out: ['.env: current'] });
    noSecret(before, json, after);
  });
});
