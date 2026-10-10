import { spawnSync } from 'node:child_process';
import {
  chmod,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject();
const root = () => dirs.root;
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: root(), ...options });
const exists = (path: string) =>
  stat(join(root(), path)).then(
    () => true,
    () => false,
  );
const read = (path: string) => readFile(join(root(), path), 'utf8');
const TOKEN = ['--set', 'TOKEN=abcdefghij'];

describe('dispatch, help and version', () => {
  it('prints the usage with --help, listing the commands and exit codes', async () => {
    const r = await cli(['--help']);
    expect(r.code).toBe(0);
    const help = r.out.join('\n');
    expect(help).toMatch(/^Usage: configure-env \[command\] \[options\]/);
    for (const word of ['apply', 'check', '--schema', '--json', '130'])
      expect(help).toContain(word);
  });

  it.each(['apply', 'check'])('prints the help of %s', async (command) => {
    const r = await cli([command, '--help']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toMatch(
      new RegExp(`^Usage: configure-env ${command}`),
    );
  });

  it('prints the package version', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(await cli(['--version'])).toMatchObject({
      code: 0,
      out: [pkg.version],
    });
  });

  it('exits 2 on an unknown command or option', async () => {
    const unknown = await cli(['frobnicate']);
    expect(unknown.code).toBe(2);
    expect(unknown.err.join('\n')).toContain('unknown command: frobnicate');
    expect((await cli(['check', '--bogus'])).code).toBe(2);
  });

  it('runs apply by default and passes over a leading --', async () => {
    const r = await cli(['--', '--ci', ...TOKEN]);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(3);
  });

  it('exits 2 with the init hint when the schema is missing', async () => {
    const r = await cli(['check', '--schema', 'nope.json']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toMatch(
      /nope\.json.*\n?.*run configure-env init/s,
    );
  });

  it('exits 1 on an invalid schema, naming the problem', async () => {
    await writeFile(join(root(), 'env.schema.json'), '{"version": 2}');
    const r = await cli(['check']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('version must be 1');
  });

  it('reads the schema from the root given by --root', async () => {
    const r = await run(['check', '--root', root()], { cwd: '/' });
    expect(r.code).toBe(1);
    expect(r.out[0]).toBe('config/app.env: missing');
  });
});

describe('apply --ci', () => {
  it('writes each file, one plain line per file', async () => {
    const r = await cli(['apply', '--ci', ...TOKEN]);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toEqual([
      'config/app.env: created',
      'shared.env: created',
      'local.env: created',
    ]);
    expect(await read('local.env')).toContain('TOKEN=abcdefghij\n');
    expect((await stat(join(root(), 'local.env'))).mode & 0o777).toBe(0o600);
    const again = await cli(['apply', '--ci', ...TOKEN]);
    expect(again.out).toEqual([
      'config/app.env: unchanged',
      'shared.env: unchanged',
      'local.env: skipped (exists)',
    ]);
  });

  it('takes --set first, then the environment, then the default', async () => {
    const r = await cli(['apply', '--ci', '--set', 'PORT=9090'], {
      env: { PORT: '7000', TOKEN: 'from-the-env', HOST: '' },
    });
    expect(r.code).toBe(0);
    const local = await read('local.env');
    expect(local).toContain('PORT=9090\n');
    expect(local).toContain('TOKEN=from-the-env\n');
    expect(local).toContain('HOST=127.0.0.1\n');
  });

  it('honours CI=true without --ci', async () => {
    const r = await cli(['apply', ...TOKEN], { env: { CI: 'true' } });
    expect(r.code).toBe(0);
  });

  it('exits 1 when a required variable has no value, writing nothing', async () => {
    const r = await cli(['apply', '--ci']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('TOKEN: is required');
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('needs no value for the variables of a file it will not write', async () => {
    await writeFile(join(root(), 'local.env'), 'HOST=web\n', { mode: 0o600 });
    const r = await cli(['apply', '--ci']);
    expect(r.code).toBe(0);
    expect(r.out[2]).toBe('local.env: skipped (exists)');
  });

  it('exits 1 on an invalid value and never echoes a secret', async () => {
    const r = await cli(['apply', '--ci', '--set', 'TOKEN=short']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('TOKEN: must be at least 8 characters');
    expect(r.err.join('\n')).not.toContain('short');
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('exits 2 on a malformed --set and 1 on an undeclared one', async () => {
    expect((await cli(['apply', '--ci', '--set', 'nokey'])).code).toBe(2);
    const r = await cli(['apply', '--ci', ...TOKEN, '--set', 'NOPE=1']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('NOPE: is not declared in the schema');
  });

  it('reports the keys a merge file gains', async () => {
    await writeFile(join(root(), 'shared.env'), 'HOST=web\nOTHER=1\n');
    const r = await cli(['apply', '--ci', '--file', 'shared.env']);
    expect(r.out).toEqual(['shared.env: added keys: PORT MODE DEBUG']);
  });

  it('limits the run to the --file paths', async () => {
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      'shared.env',
      '--file',
      'config/app.env',
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual(['config/app.env: created', 'shared.env: created']);
    expect(await exists('local.env')).toBe(false);
  });

  it('exits 2 for a --file the schema does not list', async () => {
    const r = await cli(['apply', '--ci', '--file', 'other.env']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('other.env: is not in the schema');
  });

  it('reports a refused path with its reason', async () => {
    await symlink('/etc/hosts', join(root(), 'local.env'));
    const r = await cli(['apply', '--ci', ...TOKEN]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'local.env: skipped (refused: is a symlink; refusing to write through it)',
    );
  });

  it('prints one JSON document with --json', async () => {
    const r = await cli(['apply', '--ci', '--json', ...TOKEN]);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(JSON.parse(r.out[0]!)).toEqual({
      command: 'apply',
      ok: true,
      errors: [],
      files: [
        {
          path: 'config/app.env',
          policy: 'generate',
          action: 'create',
          status: 'created',
          addedKeys: ['HOST', 'PORT', 'TOKEN', 'MODE', 'DEBUG'],
          written: true,
        },
        expect.objectContaining({ path: 'shared.env', status: 'created' }),
        expect.objectContaining({ path: 'local.env', status: 'created' }),
      ],
    });
  });

  it('reports validation errors in the JSON document', async () => {
    const r = await cli(['apply', '--ci', '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out[0]!)).toMatchObject({
      ok: false,
      errors: [{ key: 'TOKEN', message: 'is required' }],
    });
  });

  it('exits 2 without a terminal or --ci', async () => {
    const r = await cli(['apply']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toMatch(/--ci/);
  });
});

describe('apply in the terminal', () => {
  it('prompts by group with the right prompt per type, then writes', async () => {
    const { prompts, calls, logs } = scriptedPrompts({
      'API token': 'secret-value-123',
      PORT: '9191',
      MODE: 'prod',
      DEBUG: true,
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls.map((c) => [c.kind, c.message])).toEqual([
      ['multiselect', 'Which files should be written?'],
      ['text', 'Address to listen on (HOST)'],
      ['text', 'PORT'],
      ['password', 'API token (TOKEN)'],
      ['select', 'MODE'],
      ['confirm', 'DEBUG'],
      ['confirm', 'Write these changes?'],
    ]);
    expect(calls[1]).toMatchObject({
      placeholder: '127.0.0.1',
      initialValue: '127.0.0.1',
    });
    expect(logs).toContain('step: Server');
    expect(logs).toContain('step: Auth');
    const plan = logs.find((line) => line.startsWith('note: Plan'))!;
    expect(plan).toContain('TOKEN=••••23');
    expect(plan).not.toContain('secret-value-123');
    const local = await read('local.env');
    expect(local).toContain('TOKEN=secret-value-123\n');
    expect(local).toContain('PORT=9191\n');
    expect(local).toContain('MODE=prod\n');
    expect(local).toContain('DEBUG=true\n');
  });

  it('shows each file with its policy and status', async () => {
    await writeFile(join(root(), 'local.env'), 'HOST=web\n', { mode: 0o600 });
    const { prompts, calls } = scriptedPrompts({ 'API token': 'cancel' });
    await cli(['apply'], { isTTY: true, prompts });
    expect(calls[0]!.options).toEqual([
      {
        value: 'config/app.env',
        label: 'config/app.env',
        hint: 'generate; missing',
      },
      { value: 'shared.env', label: 'shared.env', hint: 'merge; missing' },
      {
        value: 'local.env',
        label: 'local.env',
        hint: 'create-only; exists, never overwritten',
      },
    ]);
  });

  it('exits 130 on cancel and writes nothing', async () => {
    const { prompts, logs } = scriptedPrompts({ 'API token': 'cancel' });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(130);
    expect(logs.some((line) => line.startsWith('cancel:'))).toBe(true);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('exits 130 when the confirmation is cancelled', async () => {
    const { prompts } = scriptedPrompts({
      'API token': 'abcdefghij',
      'Write these changes?': 'cancel',
    });
    expect((await cli(['apply'], { isTTY: true, prompts })).code).toBe(130);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('reports a refused file with its real reason, not as existing', async () => {
    await symlink('/etc/hosts', join(root(), 'local.env'));
    const { prompts, logs, calls } = scriptedPrompts({
      'Which files': ['local.env'],
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(1);
    expect(logs).toContain(
      'warn: local.env: refused: is a symlink; refusing to write through it',
    );
    expect(calls.filter((c) => c.kind === 'password')).toEqual([]);
  });

  it('offers only the --file paths', async () => {
    const { prompts, calls } = scriptedPrompts();
    const r = await cli(['apply', '--file', 'shared.env'], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(calls[0]!.options).toEqual([
      expect.objectContaining({ value: 'shared.env' }),
    ]);
    expect(await exists('config/app.env')).toBe(false);
  });
});

describe('check', () => {
  const applied = () => cli(['apply', '--ci', ...TOKEN]);

  it('exits 0 when every file is current', async () => {
    await applied();
    const r = await cli(['check']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toEqual([
      'config/app.env: current',
      'shared.env: current',
      'local.env: current',
    ]);
  });

  it('exits 1 on drift and writes nothing', async () => {
    const r = await cli(['check', '--ci']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      'config/app.env: missing',
      'shared.env: missing',
      'local.env: missing',
    ]);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('reports invalid values, masking secrets, and broken lines', async () => {
    await applied();
    await writeFile(
      join(root(), 'local.env'),
      'HOST=web\nPORT=http\nTOKEN=hunter2\nBROKEN="open\n',
      { mode: 0o600 },
    );
    const r = await cli(['check']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      'config/app.env: current',
      'shared.env: current',
      'local.env: current',
      'local.env: invalid PORT=http (must be a port between 1 and 65535)',
      'local.env: invalid TOKEN=••••••• (must be at least 8 characters)',
      'local.env: line 4 is not a valid entry',
    ]);
    expect(r.out.join('\n')).not.toContain('hunter2');
  });

  it('reports a mode that differs from the schema', async () => {
    await applied();
    await chmod(join(root(), 'local.env'), 0o644);
    const r = await cli(['check']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('local.env: mode 644, expected 600');
  });

  it('checks only the --file paths', async () => {
    await applied();
    const r = await cli(['check', '--file', 'shared.env']);
    expect(r).toMatchObject({ code: 0, out: ['shared.env: current'] });
  });

  it('prints one JSON document with --json', async () => {
    const r = await cli(['check', '--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.out.join('\n'));
    expect(report).toMatchObject({ command: 'check', ok: false, drift: true });
    expect(report.files[0]).toMatchObject({
      path: 'config/app.env',
      status: 'missing',
      drift: true,
      invalid: [],
      invalidLines: [],
    });
  });

  it('runs in the terminal, framed by the prompts', async () => {
    await applied();
    const { prompts, logs } = scriptedPrompts();
    const r = await cli(['check'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(logs.some((line) => line.startsWith('note: Check'))).toBe(true);
  });
});

describe('the cli entry point', () => {
  it('prints the help through tsx', () => {
    const pkg = fileURLToPath(new URL('../..', import.meta.url));
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', '--help'],
      { cwd: pkg, encoding: 'utf8' },
    );
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/^Usage: configure-env/);
  });
});
