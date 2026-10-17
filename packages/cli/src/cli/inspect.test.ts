// list and check: read-only views of the current values.

import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { KEY_A, KEY_B, RULES_SCHEMA, run, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 8080, description: 'Port to listen on' },
    TOKEN: {
      type: 'string',
      secret: true,
      required: true,
      minLength: 8,
      description: 'API token',
    },
    MODE: { type: 'enum', values: ['dev', 'prod'] },
    GREETING: { type: 'string' },
    DEBUG: { type: 'boolean' },
  },
  files: [
    { path: 'app.env', policy: 'merge', variables: '*' },
    { path: 'app.env.example', policy: 'merge', variables: '*' },
  ],
};

const dirs = useProject(SCHEMA);
const cli = (argv: string[]) => run(argv, { cwd: dirs.root });
const put = (name: string, content: string) =>
  writeFile(join(dirs.root, name), content);
const LONG = 'x'.repeat(50);
const VALID =
  'PORT=9090\nTOKEN=abcdefghij\nMODE=dev\nGREETING=hi\nDEBUG=true\n';
const TEMPLATE = 'PORT=<port>\nTOKEN=<token>\nMODE=\nGREETING=\nDEBUG=\n';
/** The problems of the only file a check --json report holds. */
const problemsOf = (r: { out: string[] }) =>
  JSON.parse(r.out.join('')).files[0].problems;

describe('list', () => {
  it('shows a table per file: set, valid, masked value and description', async () => {
    await put(
      'app.env',
      `PORT=http\nTOKEN=abcdefghij\nMODE=\nGREETING=${LONG}\nEXTRA=1\n`,
    );
    const r = await cli(['list', '--file', 'app.env']);
    expect(r.code).toBe(0);
    const [heading, header, ...rows] = r.out;
    expect(heading).toBe('app.env');
    expect(header).toMatch(/^KEY\s+SET\s+VALID\s+VALUE\s+DESCRIPTION$/);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatch(
      /^PORT\s+yes\s+must be a port between 1 and 65535\s+http\s+Port to listen on$/,
    );
    expect(rows[1]).toMatch(/^TOKEN\s+yes\s+ok\s+••••ij\s+API token$/);
    expect(rows[2]).toMatch(/^MODE\s+empty\s+ok\s*$/);
    expect(rows[3]).toMatch(
      new RegExp(`^GREETING\\s+yes\\s+ok\\s+${'x'.repeat(39)}…$`),
    );
    expect(rows[4]).toMatch(/^DEBUG\s+no\s+ok\s*$/);
    expect(rows[5]).toMatch(/^EXTRA\s+yes\s+unknown\s+1\s*$/);
    expect(r.out.join('\n')).not.toContain('abcdefghij');
  });

  it('lists every file grouped by path, templates unchecked', async () => {
    await put('app.env', VALID);
    await put('app.env.example', TEMPLATE);
    const r = await cli(['list']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('app.env');
    expect(r.out).toContain('app.env.example (template)');
    const blank = r.out.indexOf('');
    expect(blank).toBeGreaterThan(0);
    expect(r.out[blank + 1]).toBe('app.env.example (template)');
    expect(r.out.slice(blank)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^PORT\s+yes\s+-\s+<port>/),
      ]),
    );
  });

  it('shows a missing file with every key unset', async () => {
    const r = await cli(['list', '--file', 'app.env']);
    expect(r.out[0]).toBe('app.env (missing)');
    expect(r.out[3]).toMatch(/^TOKEN\s+no\s+is required/);
  });

  it('prints a JSON array with --json, secrets masked', async () => {
    await put('app.env', 'TOKEN=abcdefghij\nPORT=http\nEXTRA=1\n');
    const r = await cli(['list', '--json', '--file', 'app.env']);
    expect(r.code).toBe(0);
    const rows = JSON.parse(r.out.join('')) as unknown[];
    expect(rows).toEqual([
      {
        file: 'app.env',
        key: 'PORT',
        set: 'yes',
        valid: false,
        error: 'must be a port between 1 and 65535',
        value: 'http',
        description: 'Port to listen on',
      },
      {
        file: 'app.env',
        key: 'TOKEN',
        set: 'yes',
        valid: true,
        masked: '••••ij',
        description: 'API token',
      },
      { file: 'app.env', key: 'MODE', set: 'no', valid: true },
      { file: 'app.env', key: 'GREETING', set: 'no', valid: true },
      { file: 'app.env', key: 'DEBUG', set: 'no', valid: true },
      {
        file: 'app.env',
        key: 'EXTRA',
        set: 'yes',
        valid: null,
        unknown: true,
        value: '1',
      },
    ]);
    expect(r.out.join('')).not.toContain('abcdefghij');
  });
});

describe('check over the current values', () => {
  it('exits 0 when every file is valid', async () => {
    await put('app.env', VALID);
    await put('app.env.example', TEMPLATE);
    const r = await cli(['check']);
    expect(r).toMatchObject({
      code: 0,
      out: ['app.env: ok', 'app.env.example: ok', 'Everything is current.'],
    });
  });

  it('reports missing keys, type errors, required values and broken lines', async () => {
    await put(
      'app.env',
      'PORT=http\nGREETING="open\nMODE=dev\nTOKEN=\nDEBUG=\n',
    );
    await put('app.env.example', TEMPLATE);
    const r = await cli(['check']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      'app.env: GREETING: is missing',
      'app.env: line 2 is not a valid entry',
      'app.env: PORT: must be a port between 1 and 65535 (got http)',
      'app.env: TOKEN: is required',
      'app.env.example: ok',
      '4 errors, 0 warnings in 1 file',
    ]);
  });

  it('never prints a secret value', async () => {
    await put('app.env', `${VALID.replace('abcdefghij', 'short')}`);
    const r = await cli(['check', '--file', 'app.env']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      'app.env: TOKEN: must be at least 8 characters (got •••••)',
      '1 error, 0 warnings in 1 file',
    ]);
    expect(r.out.join('')).not.toContain('short');
  });

  it('warns about unknown keys and exits 0, an error with --strict', async () => {
    await put('app.env', `${VALID}EXTRA=1\n`);
    const r = await cli(['check', '--file', 'app.env']);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'app.env: warning: EXTRA: is not in the schema for this file',
        '0 errors, 1 warning in 1 file',
      ],
    });
    const strict = await cli(['check', '--file', 'app.env', '--strict']);
    expect(strict).toMatchObject({
      code: 1,
      out: [
        'app.env: EXTRA: is not in the schema for this file',
        '1 error, 0 warnings in 1 file',
      ],
    });
  });

  it('checks templates only for broken lines and missing keys', async () => {
    await put('app.env', VALID);
    await put('app.env.example', 'PORT=<port>\nBAD LINE\nTOKEN=\n');
    const r = await cli(['check', '--file', 'app.env.example']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      'app.env.example: MODE: is missing',
      'app.env.example: GREETING: is missing',
      'app.env.example: DEBUG: is missing',
      'app.env.example: line 2 is not a valid entry',
      '4 errors, 0 warnings in 1 file',
    ]);
  });

  it('skips the placeholders a file sets through `values`', async () => {
    await put(
      'env.schema.json',
      JSON.stringify({
        ...SCHEMA,
        files: [{ ...SCHEMA.files[0], values: { TOKEN: '<token>' } }],
      }),
    );
    await put('app.env', VALID.replace('abcdefghij', '<token>'));
    expect(await cli(['check'])).toMatchObject({
      code: 0,
      out: ['app.env: ok', 'Everything is current.'],
    });
  });

  it('reports a missing file', async () => {
    const r = await cli(['check', '--file', 'app.env']);
    expect(r).toMatchObject({
      code: 1,
      out: ['app.env: missing', '1 error, 0 warnings in 1 file'],
    });
  });

  it('prints one JSON document with --json: problems by file, with a summary', async () => {
    await put('app.env', VALID.replace('9090', 'http') + 'EXTRA=1\n');
    const r = await cli(['check', '--json', '--file', 'app.env']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out.join(''))).toEqual({
      command: 'check',
      ok: false,
      summary: { errors: 1, warnings: 1, files: 1, failing: 1 },
      files: [
        {
          path: 'app.env',
          policy: 'merge',
          template: false,
          status: 'current',
          ok: false,
          problems: [
            {
              severity: 'error',
              code: 'invalid-value',
              key: 'PORT',
              message: 'must be a port between 1 and 65535',
              shown: 'http',
              fix: 'set',
            },
            {
              severity: 'warning',
              code: 'unknown-key',
              key: 'EXTRA',
              message: 'is not in the schema for this file',
              fix: 'prune',
            },
          ],
        },
      ],
      gitignore: [],
      errors: [],
    });
  });

  it('exits 0 with --json when it finds warnings only', async () => {
    await put('app.env', `${VALID}EXTRA=1\n`);
    const r = await cli(['check', '--json', '--file', 'app.env']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.join(''))).toMatchObject({
      ok: true,
      summary: { errors: 0, warnings: 1, files: 1, failing: 0 },
    });
  });
});

describe('validate', () => {
  it('is no longer a command', async () => {
    const r = await cli(['validate']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('unknown command: validate');
    expect(r.out).toEqual([]);
  });

  it('is not in the main help', async () => {
    expect((await cli(['--help'])).out.join('\n')).not.toContain('validate');
  });
});

describe('rules between variables', () => {
  const useRules = () =>
    writeFile(join(dirs.root, 'env.schema.json'), JSON.stringify(RULES_SCHEMA));
  // .env is create-only with mode 600: written so, its mode is current.
  const env = async (values: Record<string, string>) => {
    await put(
      '.env',
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
    await chmod(join(dirs.root, '.env'), 0o600);
  };

  it('check reports each broken rule, naming the keys and never a value', async () => {
    await useRules();
    await env({
      SM_MASTER_KEY: KEY_A,
      SM_MASTER_KEY_FILE: '/run/secrets/key',
      SM_PREVIOUS_MASTER_KEY: KEY_A,
    });
    const r = await cli(['check', '--file', '.env']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      '.env: SM_MASTER_KEY, SM_MASTER_KEY_FILE: set only one of them',
      '.env: SM_PREVIOUS_MASTER_KEY: must differ from SM_MASTER_KEY',
      '2 errors, 0 warnings in 1 file',
    ]);
    expect(r.out.join('\n')).not.toContain(KEY_A);
  });

  it('check reports a variable required unless another is set', async () => {
    await useRules();
    await env({ SM_MASTER_KEY: '' });
    const r = await cli(['check', '--json', '--file', '.env']);
    expect(r.code).toBe(1);
    expect(
      problemsOf(r).filter((p: { code: string }) => p.code === 'rule'),
    ).toEqual([
      {
        severity: 'error',
        code: 'rule',
        key: 'SM_MASTER_KEY',
        message: 'required unless SM_MASTER_KEY_FILE is set',
        fix: 'set',
      },
    ]);
    await env({ SM_MASTER_KEY_FILE: '/run/secrets/key' });
    expect(await cli(['check', '--file', '.env'])).toMatchObject({
      code: 0,
      out: ['.env: ok', 'Everything is current.'],
    });
  });

  it('check --json gives a conflict both keys', async () => {
    await useRules();
    await env({ SM_MASTER_KEY: KEY_A, SM_MASTER_KEY_FILE: '/k' });
    const r = await cli(['check', '--json', '--file', '.env']);
    expect(
      problemsOf(r).filter((p: { code: string }) => p.code === 'rule'),
    ).toEqual([
      {
        severity: 'error',
        code: 'rule',
        key: 'SM_MASTER_KEY',
        keys: ['SM_MASTER_KEY', 'SM_MASTER_KEY_FILE'],
        message: 'set only one of them',
        fix: 'set',
      },
    ]);
  });

  it('check checks no rule in a template', async () => {
    await useRules();
    await put(
      '.env.example',
      'SM_MASTER_KEY=\nSM_MASTER_KEY_FILE=\nSM_PREVIOUS_MASTER_KEY=\nSM_PREVIOUS_MASTER_KEY_FILE=\n',
    );
    expect((await cli(['check', '--file', '.env.example'])).out).toEqual([
      '.env.example: ok',
      'Everything is current.',
    ]);
  });

  it('list shows the broken rule in the VALID column of its keys', async () => {
    await useRules();
    await env({
      SM_MASTER_KEY: KEY_A,
      SM_MASTER_KEY_FILE: '/k',
      SM_PREVIOUS_MASTER_KEY: KEY_B,
    });
    const r = await cli(['list', '--file', '.env']);
    expect(r.out[2]).toMatch(
      /^SM_MASTER_KEY\s+yes\s+set only one of SM_MASTER_KEY, SM_MASTER_KEY_FILE\s/,
    );
    expect(r.out[3]).toMatch(
      /^SM_MASTER_KEY_FILE\s+yes\s+set only one of SM_MASTER_KEY, SM_MASTER_KEY_FILE\s/,
    );
    expect(r.out[4]).toMatch(/^SM_PREVIOUS_MASTER_KEY\s+yes\s+ok\s/);
    await env({ SM_PREVIOUS_MASTER_KEY: KEY_B });
    const json = JSON.parse(
      (await cli(['list', '--json', '--file', '.env'])).out.join(''),
    ) as { key: string; valid: boolean; error?: string }[];
    expect(json[0]).toMatchObject({
      key: 'SM_MASTER_KEY',
      valid: false,
      error: 'required unless SM_MASTER_KEY_FILE is set',
    });
    expect(JSON.stringify(json)).not.toContain(KEY_B);
  });
});

describe('help', () => {
  it.each(['list', 'check'])('prints the help of %s', async (command) => {
    const r = await cli([command, '--help']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toMatch(
      new RegExp(`^Usage: configure-env ${command}`),
    );
  });
});
