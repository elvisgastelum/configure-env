import { spawnSync } from 'node:child_process';
import {
  chmod,
  readFile,
  readdir,
  rm,
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
      deferred: [],
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

  it('takes a --set value over a prompt, even for a secret', async () => {
    const { prompts, calls } = scriptedPrompts();
    const r = await cli(['apply', '--set', 'TOKEN=abcdefghij'], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(calls.filter((c) => c.message.includes('TOKEN'))).toEqual([]);
    expect(await read('local.env')).toContain('TOKEN=abcdefghij\n');
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

describe('apply --generate', () => {
  /** A required secret over a merge, a create-only and a generate file. */
  const useSecretSchema = (secret: Record<string, unknown> = {}) =>
    writeFile(
      join(root(), 'env.schema.json'),
      JSON.stringify({
        version: 1,
        variables: {
          SECRET: {
            type: 'string',
            secret: true,
            required: true,
            minLength: 32,
            ...secret,
          },
          PORT: { type: 'port', default: 8080 },
        },
        files: [
          { path: 'merge.env', policy: 'merge', variables: '*' },
          { path: 'local.env', policy: 'create-only', variables: '*' },
          { path: 'gen.env', policy: 'generate', variables: '*' },
          { path: 'gen.env.example', policy: 'generate', variables: '*' },
        ],
      }),
    );
  const secretIn = async (path: string) =>
    /^SECRET=(.*)$/m.exec(await read(path))?.[1];
  const FILES = ['--file', 'merge.env', '--file', 'local.env'];

  it('writes one random value to every file that lacks it, never printing it', async () => {
    await useSecretSchema();
    const r = await cli(['apply', '--ci', '--generate', 'SECRET', ...FILES]);
    expect(r).toMatchObject({ code: 0, err: [] });
    const value = (await secretIn('merge.env'))!;
    expect(value).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(await secretIn('local.env')).toBe(value);
    expect(r.out.join('\n')).not.toContain(value);
    const again = await cli([
      'apply',
      '--ci',
      '--generate',
      'SECRET',
      ...FILES,
    ]);
    expect(again.out).toEqual([
      'merge.env: unchanged',
      'local.env: skipped (exists)',
    ]);
    expect(await secretIn('merge.env')).toBe(value);
  });

  it('reuses a value a file of the run holds, and prints no value in JSON', async () => {
    await useSecretSchema();
    const kept = 'k'.repeat(32);
    await writeFile(join(root(), 'merge.env'), `SECRET=${kept}\n`);
    const r = await cli(['apply', '--json', '--generate', 'SECRET', ...FILES]);
    expect(r.code).toBe(0);
    expect(await secretIn('merge.env')).toBe(kept);
    expect(await secretIn('local.env')).toBe(kept);
    expect(JSON.parse(r.out.join('')).ok).toBe(true);
    expect([...r.out, ...r.err].join('\n')).not.toContain(kept);
  });

  it('writes the same value again after a file is deleted', async () => {
    await useSecretSchema();
    await cli(['apply', '--ci', '--generate', 'SECRET', ...FILES]);
    const value = (await secretIn('merge.env'))!;
    for (const lost of ['local.env', 'merge.env']) {
      await rm(join(root(), lost));
      const r = await cli(['apply', '--ci', '--generate', 'SECRET', ...FILES]);
      expect(r.code).toBe(0);
      expect(await secretIn('merge.env')).toBe(value);
      expect(await secretIn('local.env')).toBe(value);
      expect(r.out.join('\n')).not.toContain(value);
    }
  });

  it('reuses a held value in the terminal too', async () => {
    await useSecretSchema();
    const kept = 'k'.repeat(32);
    await writeFile(join(root(), 'local.env'), `SECRET=${kept}\n`);
    // An existing create-only file is not picked by default: pick it here.
    const { prompts, logs } = scriptedPrompts({
      'Which files': ['merge.env', 'local.env'],
    });
    const r = await cli(['apply', '--generate', 'SECRET', ...FILES], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(await secretIn('merge.env')).toBe(kept);
    expect(logs.join('\n')).not.toContain(kept);
  });

  it('exits 2 when files of the run hold different values, naming no value', async () => {
    await useSecretSchema();
    const one = 'a'.repeat(32);
    const two = 'b'.repeat(32);
    await writeFile(join(root(), 'merge.env'), `SECRET=${one}\n`);
    await writeFile(join(root(), 'local.env'), `SECRET=${two}\n`);
    const r = await cli(['apply', '--ci', '--generate', 'SECRET', ...FILES]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      'configure-env: SECRET: --generate found different values in merge.env, local.env',
      'set the same value in each, or pass --file to leave one out of the run',
    ]);
    expect([...r.out, ...r.err].join('\n')).not.toMatch(/aaaa|bbbb/);
    expect(await secretIn('merge.env')).toBe(one);
    const limited = await cli([
      'apply',
      '--ci',
      '--generate',
      'SECRET',
      '--file',
      'merge.env',
    ]);
    expect(limited.code).toBe(0);
  });

  it('takes a secret that a generate file sets through values', async () => {
    const r = await cli(['apply', '--ci', '--generate', 'TOKEN']);
    expect(r.code).toBe(0);
    expect(await read('config/app.env')).toContain('TOKEN=<token>\n');
    expect(await read('local.env')).toMatch(/^TOKEN=[A-Za-z0-9_-]{48}$/m);
  });

  it('exits 2 when a chosen generate file would rewrite it on every run', async () => {
    await useSecretSchema();
    const r = await cli(['apply', '--ci', '--generate', 'SECRET']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('gen.env');
    expect(r.err.join('\n')).not.toContain('gen.env.example');
    expect(await readdir(root())).toEqual(['env.schema.json']);
    const template = await cli([
      'apply',
      '--ci',
      '--generate',
      'SECRET',
      '--file',
      'gen.env.example',
    ]);
    expect(template.code).toBe(0);
  });

  it('exits 2 for a non-secret, undeclared or --set key', async () => {
    await useSecretSchema();
    const port = await cli(['apply', '--ci', '--generate', 'PORT', ...FILES]);
    expect(port.code).toBe(2);
    expect(port.err).toEqual([
      'configure-env: PORT: --generate takes a secret string variable',
    ]);
    expect(
      (await cli(['apply', '--ci', '--generate', 'NOPE', ...FILES])).code,
    ).toBe(2);
    const both = await cli([
      'apply',
      '--ci',
      '--set',
      `SECRET=${'s'.repeat(32)}`,
      '--generate',
      'SECRET',
      ...FILES,
    ]);
    expect(both.code).toBe(2);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('prints the failure JSON when --generate cannot finish, keeping the exit code', async () => {
    await useSecretSchema({ pattern: '^[0-9]+$' });
    const none = await cli([
      'apply',
      '--json',
      '--generate',
      'SECRET',
      ...FILES,
    ]);
    expect(none).toMatchObject({ code: 1, err: [] });
    expect(JSON.parse(none.out.join(''))).toEqual({
      command: 'apply',
      ok: false,
      errors: [
        {
          kind: 'value',
          key: 'SECRET',
          message:
            'cannot generate a value that passes its rules; set it with --prompt or --stdin',
        },
      ],
      files: [],
      deferred: [],
    });
    await useSecretSchema();
    await writeFile(join(root(), 'merge.env'), `SECRET=${'a'.repeat(32)}\n`);
    await writeFile(join(root(), 'local.env'), `SECRET=${'b'.repeat(32)}\n`);
    const differ = await cli([
      'apply',
      '--json',
      '--generate',
      'SECRET',
      ...FILES,
    ]);
    expect(differ).toMatchObject({ code: 2, err: [] });
    expect(JSON.parse(differ.out.join('')).errors).toEqual([
      {
        kind: 'value',
        key: 'SECRET',
        message: '--generate found different values in merge.env, local.env',
      },
    ]);
    expect(differ.out.join('')).not.toMatch(/aaaa|bbbb/);
  });

  it('prints the failure JSON for a key the options misuse', async () => {
    await useSecretSchema();
    const cases: [string[], string, string][] = [
      [
        ['--generate', 'PORT'],
        'PORT',
        '--generate takes a secret string variable',
      ],
      [
        ['--set', 'SECRET=x', '--generate', 'SECRET'],
        'SECRET',
        '--generate takes a key given no other way',
      ],
      [['--defer', 'NOPE'], 'NOPE', 'is not declared in the schema'],
      [
        ['--generate', 'SECRET', '--file', 'gen.env'],
        'SECRET',
        '--generate would rotate it on every run of gen.env, a generate file',
      ],
    ];
    for (const [args, key, message] of cases) {
      const r = await cli(['apply', '--json', ...args]);
      expect(r).toMatchObject({ code: 2, err: [] });
      expect(JSON.parse(r.out.join(''))).toEqual({
        command: 'apply',
        ok: false,
        errors: [{ kind: 'value', key, message }],
        files: [],
        deferred: [],
      });
    }
  });

  it('exits 1 and writes nothing when no value passes the rules', async () => {
    await useSecretSchema({ pattern: '^[0-9]+$' });
    const r = await cli(['apply', '--ci', '--generate', 'SECRET', ...FILES]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(
      'SECRET: cannot generate a value that passes its rules',
    );
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('is not prompted for in the terminal, and refuses a picked generate file', async () => {
    await useSecretSchema();
    const { prompts, calls } = scriptedPrompts();
    const r = await cli(['apply', '--generate', 'SECRET', ...FILES], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(calls.filter((c) => c.message.includes('SECRET'))).toEqual([]);
    expect(await secretIn('local.env')).toMatch(/^[A-Za-z0-9_-]{48}$/);
    const picked = scriptedPrompts({ 'Which files': ['gen.env'] });
    const refused = await cli(['apply', '--generate', 'SECRET'], {
      isTTY: true,
      prompts: picked.prompts,
    });
    expect(refused.code).toBe(2);
    expect(await exists('gen.env')).toBe(false);
  });
});

describe('apply --defer', () => {
  /** A generated secret and a human-only one, over a template and a 600 file. */
  const useDeferSchema = (token: Record<string, unknown> = {}) =>
    writeFile(
      join(root(), 'env.schema.json'),
      JSON.stringify({
        version: 1,
        variables: {
          PORT: { type: 'port', default: 3000 },
          SESSION_SECRET: {
            type: 'string',
            secret: true,
            required: true,
            minLength: 32,
          },
          API_TOKEN: { type: 'string', secret: true, required: true, ...token },
        },
        files: [
          { path: '.env.example', policy: 'merge', variables: '*' },
          {
            path: '.env',
            policy: 'create-only',
            variables: '*',
            mode: '600',
          },
        ],
      }),
    );
  const SETUP = ['apply', '--ci', '--generate', 'SESSION_SECRET'];

  it('creates the files with the deferred key empty and reports it', async () => {
    await useDeferSchema();
    const r = await cli([...SETUP, '--defer', 'API_TOKEN']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toEqual([
      '.env.example: created',
      '.env: created',
      'deferred: API_TOKEN (set it with configure-env set --file .env --prompt API_TOKEN)',
    ]);
    const env = await read('.env');
    expect(env).toMatch(/^PORT=3000$/m);
    expect(env).toMatch(/^SESSION_SECRET=[A-Za-z0-9_-]{48}$/m);
    expect(env).toMatch(/^API_TOKEN=$/m);
    expect((await stat(join(root(), '.env'))).mode & 0o777).toBe(0o600);
  });

  it('lists the deferred keys in JSON, an empty array when none', async () => {
    await useDeferSchema();
    const r = await cli([...SETUP, '--json', '--defer', 'API_TOKEN']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.join(''))).toMatchObject({
      ok: true,
      errors: [],
      deferred: ['API_TOKEN'],
    });
    const none = await cli([...SETUP, '--json', '--set', 'API_TOKEN=x']);
    expect(JSON.parse(none.out.join(''))).toMatchObject({ deferred: [] });
  });

  it('still fails and writes nothing without --defer', async () => {
    await useDeferSchema();
    const r = await cli(SETUP);
    expect(r.code).toBe(1);
    expect(r.err).toEqual(['configure-env: API_TOKEN: is required']);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('fails the run for a required key that is not deferred', async () => {
    await useDeferSchema();
    const r = await cli(['apply', '--ci', '--defer', 'API_TOKEN']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual(['configure-env: SESSION_SECRET: is required']);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('exits 2 for a key given with --set or --generate, or undeclared', async () => {
    await useDeferSchema();
    const set = await cli([
      ...SETUP,
      '--set',
      'API_TOKEN=x',
      '--defer',
      'API_TOKEN',
    ]);
    expect(set.code).toBe(2);
    expect(set.err).toEqual([
      'configure-env: API_TOKEN: --defer takes a key given no other way',
    ]);
    const generated = await cli([...SETUP, '--defer', 'SESSION_SECRET']);
    expect(generated.code).toBe(2);
    const unknown = await cli([...SETUP, '--defer', 'NOPE']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toEqual([
      'configure-env: NOPE: is not declared in the schema',
    ]);
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('writes a deferred key that has an env value or a default', async () => {
    await useDeferSchema();
    const r = await cli([...SETUP, '--defer', 'API_TOKEN'], {
      env: { API_TOKEN: 'from-env' },
    });
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).not.toContain('deferred');
    expect(await read('.env')).toMatch(/^API_TOKEN=from-env$/m);
    await rm(join(root(), '.env'));
    await useDeferSchema({ default: 'dflt' });
    const json = await cli([...SETUP, '--json', '--defer', 'API_TOKEN']);
    expect(JSON.parse(json.out.join(''))).toMatchObject({ deferred: [] });
    expect(await read('.env')).toMatch(/^API_TOKEN=dflt$/m);
  });

  it('is not prompted for in the terminal', async () => {
    await useDeferSchema();
    const { prompts, calls, logs } = scriptedPrompts();
    const r = await cli(
      [...SETUP.filter((a) => a !== '--ci'), '--defer', 'API_TOKEN'],
      {
        isTTY: true,
        prompts,
      },
    );
    expect(r.code).toBe(0);
    expect(calls.filter((c) => c.message.includes('API_TOKEN'))).toEqual([]);
    expect(await read('.env')).toMatch(/^API_TOKEN=$/m);
    expect(logs.join('\n')).toContain('deferred: API_TOKEN');
  });

  it('exits 2 for a key that is not required', async () => {
    await useDeferSchema();
    const r = await cli([...SETUP, '--defer', 'PORT']);
    expect(r).toMatchObject({
      code: 2,
      err: ['configure-env: PORT: --defer takes a required variable'],
    });
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  it('lists no deferred key when the run fails and writes nothing', async () => {
    await useDeferSchema();
    const r = await cli(['apply', '--json', '--defer', 'API_TOKEN']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out.join(''))).toMatchObject({
      ok: false,
      errors: [{ kind: 'value', key: 'SESSION_SECRET' }],
      deferred: [],
    });
    expect(await readdir(root())).toEqual(['env.schema.json']);
  });

  describe('with two real files', () => {
    const useTwoFiles = () =>
      writeFile(
        join(root(), 'env.schema.json'),
        JSON.stringify({
          version: 1,
          variables: {
            API_TOKEN: { type: 'string', secret: true, required: true },
          },
          files: [
            { path: '.env.example', policy: 'merge', variables: '*' },
            { path: '.env', policy: 'create-only', variables: '*' },
            { path: '.env.test', policy: 'create-only', variables: '*' },
          ],
        }),
      );

    it('names only the files the run wrote', async () => {
      await useTwoFiles();
      const r = await cli([
        'apply',
        '--ci',
        '--file',
        '.env',
        '--defer',
        'API_TOKEN',
      ]);
      expect(r).toMatchObject({ code: 0, err: [] });
      expect(r.out).toEqual([
        '.env: created',
        'deferred: API_TOKEN (set it with configure-env set --file .env --prompt API_TOKEN)',
      ]);
    });

    it('names only the files picked in the terminal', async () => {
      await useTwoFiles();
      const { prompts, logs } = scriptedPrompts({ 'Which files': ['.env'] });
      const r = await cli(['apply', '--defer', 'API_TOKEN'], {
        isTTY: true,
        prompts,
      });
      expect(r.code).toBe(0);
      const outro = logs.filter((line) => line.startsWith('outro:')).join('\n');
      expect(outro).toContain(
        'deferred: API_TOKEN (set it with configure-env set --file .env --prompt API_TOKEN)',
      );
      expect(outro).not.toContain('.env.test');
    });
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

  it('ignores the environment unless --use-env', async () => {
    await applied();
    const env = { PORT: '9999', TOKEN: 'another-token' };
    expect((await cli(['check'], { env })).code).toBe(0);
    const r = await cli(['check', '--use-env'], { env });
    expect(r.code).toBe(1);
    expect(r.out).toContain('config/app.env: differs from the schema');
  });

  it('compares with --set values without --use-env', async () => {
    await applied();
    const r = await cli(['check', '--set', 'PORT=9999']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('config/app.env: differs from the schema');
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
