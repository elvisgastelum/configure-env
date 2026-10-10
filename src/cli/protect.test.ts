// Protected variables: set, unset and apply never change a protected value
// silently, even after the file that held it was deleted.

import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getValue, parseDotenv } from '../engine/dotenv.ts';
import {
  KEY_A,
  KEY_B,
  run,
  scriptedPrompts,
  useProject,
} from './test-helpers.ts';

const REASON = 'it encrypts the vault';

/** secret-manager's master key, protected, and a protected generate file. */
const PROTECTED_SCHEMA = {
  version: 1,
  variables: {
    SM_MASTER_KEY: {
      type: 'string',
      secret: true,
      encoding: 'base64',
      bytes: 32,
      requiredUnless: 'SM_MASTER_KEY_FILE',
      conflictsWith: 'SM_MASTER_KEY_FILE',
      protected: { reason: REASON },
    },
    SM_MASTER_KEY_FILE: { type: 'string' },
    API_KEY: { type: 'string', secret: true, protected: true },
    PORT: { type: 'port', default: 8080 },
  },
  files: [
    {
      path: '.env.example',
      policy: 'merge',
      variables: ['SM_MASTER_KEY', 'SM_MASTER_KEY_FILE'],
    },
    {
      path: '.env',
      policy: 'create-only',
      mode: '600',
      variables: ['SM_MASTER_KEY', 'SM_MASTER_KEY_FILE'],
    },
    { path: 'worker.env', policy: 'merge', variables: ['SM_MASTER_KEY'] },
    { path: 'gen.env', policy: 'generate', variables: ['API_KEY', 'PORT'] },
  ],
};

const dirs = useProject(PROTECTED_SCHEMA);
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const path = (name: string) => join(dirs.root, name);
const read = (name: string) => readFile(path(name), 'utf8');
const exists = (name: string) =>
  stat(path(name)).then(
    () => true,
    () => false,
  );
const STATE = '.configure-env/state.json';
const state = async () =>
  JSON.parse(await read(STATE)) as {
    fingerprints: Record<string, Record<string, { hmac: string }>>;
  };
const valueIn = async (file: string, key: string) =>
  getValue(parseDotenv(await read(file)), key);
const today = () => new Date().toISOString().slice(0, 10);

/** No output and no state text holds a value. */
async function expectNoValue(
  runs: { out: string[]; err: string[] }[],
  ...values: string[]
) {
  const text = [
    ...runs.flatMap((r) => [...r.out, ...r.err]),
    (await exists(STATE)) ? await read(STATE) : '',
  ].join('\n');
  for (const value of values) expect(text).not.toContain(value);
}

const PROTECTED = `configure-env: SM_MASTER_KEY: is protected (${REASON}); pass --replace-protected SM_MASTER_KEY to change it`;
const wasSet = () =>
  `SM_MASTER_KEY was set on ${today()}; restore it from your backup, or pass --replace-protected SM_MASTER_KEY`;

/** `.env` holding KEY_A, recorded by a set. */
async function seedKey() {
  const r = await cli([
    'set',
    '--create',
    '--file',
    '.env',
    `SM_MASTER_KEY=${KEY_A}`,
  ]);
  expect(r.code).toBe(0);
}

describe('set', () => {
  it('records the value it writes, never holding it, with mode 600', async () => {
    const r = await cli([
      'set',
      '--create',
      '--file',
      '.env',
      `SM_MASTER_KEY=${KEY_A}`,
    ]);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(Object.keys((await state()).fingerprints)).toEqual(['.env']);
    expect((await stat(path(STATE))).mode & 0o777).toBe(0o600);
    await expectNoValue([r], KEY_A);
  });

  it('refuses every form of a different value, exit 2, writing nothing', async () => {
    await seedKey();
    const before = await read('.env');
    const pair = await cli(['set', '--file', '.env', `SM_MASTER_KEY=${KEY_B}`]);
    expect(pair).toMatchObject({
      code: 2,
      out: [],
      err: [PROTECTED, 'nothing was written to .env'],
    });
    const piped = await cli(
      ['set', '--file', '.env', '--stdin', 'SM_MASTER_KEY'],
      {
        stdin: `${KEY_B}\n`,
      },
    );
    expect(piped.code).toBe(2);
    expect(piped.err[0]).toBe(PROTECTED);
    const { prompts } = scriptedPrompts({ SM_MASTER_KEY: KEY_B });
    const prompted = await cli(
      ['set', '--file', '.env', '--prompt', 'SM_MASTER_KEY'],
      {
        isTTY: true,
        prompts,
      },
    );
    expect(prompted.code).toBe(2);
    const emptied = await cli(['set', '--file', '.env', 'SM_MASTER_KEY=']);
    expect(emptied.code).toBe(2);
    expect(await read('.env')).toBe(before);
    await expectNoValue([pair, piped, prompted, emptied], KEY_A, KEY_B);
  });

  it('reports the same value as unchanged', async () => {
    await seedKey();
    const r = await cli(['set', '--file', '.env', `SM_MASTER_KEY=${KEY_A}`]);
    expect(r).toMatchObject({
      code: 0,
      out: ['SM_MASTER_KEY: unchanged (••••s=)'],
    });
    const generated = await cli([
      'set',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(generated.code).toBe(0);
    expect(generated.out[0]).toMatch(/^SM_MASTER_KEY: unchanged/);
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_A);
  });

  it('refuses --generate for an emptied key with a recorded value', async () => {
    await seedKey();
    await writeFile(path('.env'), 'SM_MASTER_KEY=\n');
    const r = await cli([
      'set',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(r).toMatchObject({ code: 2, out: [] });
    expect(r.err[0]).toBe(`configure-env: ${wasSet()}`);
    expect(await read('.env')).toBe('SM_MASTER_KEY=\n');
    // Leaving it empty is fine.
    const empty = await cli([
      'set',
      '--file',
      '.env',
      'SM_MASTER_KEY=',
      'SM_MASTER_KEY_FILE=/run/key',
    ]);
    expect(empty.code).toBe(0);
  });

  it('takes the recorded value back after the file is deleted', async () => {
    await seedKey();
    await rm(path('.env'));
    const other = await cli([
      'set',
      '--create',
      '--file',
      '.env',
      `SM_MASTER_KEY=${KEY_B}`,
    ]);
    expect(other.code).toBe(2);
    expect(other.err[0]).toBe(`configure-env: ${wasSet()}`);
    expect(await exists('.env')).toBe(false);
    const restored = await cli(
      ['set', '--create', '--file', '.env', '--stdin', 'SM_MASTER_KEY'],
      { stdin: `${KEY_A}\n` },
    );
    expect(restored).toMatchObject({ code: 0, err: [] });
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_A);
    await expectNoValue([other, restored], KEY_A, KEY_B);
  });

  it('copies the same value to a second file, with a fingerprint per file', async () => {
    await seedKey();
    const r = await cli(
      ['set', '--create', '--file', 'worker.env', '--stdin', 'SM_MASTER_KEY'],
      { stdin: KEY_A },
    );
    expect(r.code).toBe(0);
    const { fingerprints } = await state();
    expect(Object.keys(fingerprints).sort()).toEqual(['.env', 'worker.env']);
    // One salt: the same value, the same HMAC.
    expect(fingerprints['worker.env']!.SM_MASTER_KEY!.hmac).toBe(
      fingerprints['.env']!.SM_MASTER_KEY!.hmac,
    );
  });

  it('never applies to a template', async () => {
    await writeFile(path('.env.example'), 'SM_MASTER_KEY=<key>\n');
    const r = await cli([
      'set',
      '--file',
      '.env.example',
      '--allow-template',
      'SM_MASTER_KEY=<base64 key>',
    ]);
    expect(r.code).toBe(1); // the placeholder is not base64; not a protected refusal
    expect(r.err.join('\n')).not.toContain('protected');
    expect(await exists(STATE)).toBe(false);
  });
});

describe('unset', () => {
  it('refuses to remove a protected value, exit 2', async () => {
    await seedKey();
    const before = await read('.env');
    const r = await cli(['unset', '--file', '.env', 'SM_MASTER_KEY']);
    expect(r).toMatchObject({
      code: 2,
      out: [],
      err: [PROTECTED, 'nothing was written to .env'],
    });
    expect(await read('.env')).toBe(before);
  });

  it('moves from the key to its file only with --replace-protected', async () => {
    await seedKey();
    const r = await cli([
      'unset',
      '--ci',
      '--file',
      '.env',
      '--replace-protected',
      'SM_MASTER_KEY',
      'SM_MASTER_KEY',
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: ['SM_MASTER_KEY: removed', 'replaced protected SM_MASTER_KEY'],
    });
    expect((await state()).fingerprints).toEqual({});
    const swap = await cli([
      'set',
      '--file',
      '.env',
      'SM_MASTER_KEY_FILE=/run/key',
    ]);
    expect(swap.code).toBe(0);
    expect((await cli(['validate', '--file', '.env'])).code).toBe(0);
  });

  it('reports a replacement in JSON as a field of the key', async () => {
    await seedKey();
    const r = await cli([
      'unset',
      '--json',
      '--file',
      '.env',
      '--replace-protected',
      'SM_MASTER_KEY',
      'SM_MASTER_KEY',
    ]);
    expect(JSON.parse(r.out[0]!)).toEqual({
      command: 'unset',
      ok: true,
      file: '.env',
      keys: [{ key: 'SM_MASTER_KEY', status: 'removed', replaced: true }],
    });
  });
});

describe('--replace-protected', () => {
  it('asks in a terminal for the key name before replacing', async () => {
    await seedKey();
    const { prompts, calls } = scriptedPrompts({
      'Type SM_MASTER_KEY': 'SM_MASTER_KEY',
    });
    const r = await cli(
      [
        'set',
        '--file',
        '.env',
        '--replace-protected',
        'SM_MASTER_KEY',
        `SM_MASTER_KEY=${KEY_B}`,
      ],
      { isTTY: true, prompts },
    );
    expect(r).toMatchObject({
      code: 0,
      out: [
        'SM_MASTER_KEY: updated (••••o=)',
        'replaced protected SM_MASTER_KEY',
      ],
    });
    expect(calls.map((call) => call.message)).toEqual([
      'Type SM_MASTER_KEY to replace its protected value',
    ]);
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_B);
    // The new value is the recorded one now.
    await rm(path('.env'));
    const restored = await cli(
      ['set', '--create', '--file', '.env', '--stdin', 'SM_MASTER_KEY'],
      { stdin: KEY_B },
    );
    expect(restored.code).toBe(0);
  });

  it('writes nothing on a wrong name (exit 2) or a cancel (exit 130)', async () => {
    await seedKey();
    const before = await read('.env');
    const args = [
      'set',
      '--file',
      '.env',
      '--replace-protected',
      'SM_MASTER_KEY',
      `SM_MASTER_KEY=${KEY_B}`,
    ];
    const wrong = await cli(args, {
      isTTY: true,
      prompts: scriptedPrompts({ 'Type SM_MASTER_KEY': 'SM_MASTER' }).prompts,
    });
    expect(wrong).toMatchObject({
      code: 2,
      err: [
        'configure-env: SM_MASTER_KEY: the confirmation did not match; nothing was written',
      ],
    });
    const cancelled = await cli(args, {
      isTTY: true,
      prompts: scriptedPrompts({ 'Type SM_MASTER_KEY': 'cancel' }).prompts,
    });
    expect(cancelled.code).toBe(130);
    expect(await read('.env')).toBe(before);
  });

  it('needs no confirmation under --ci, and a terminal otherwise', async () => {
    await seedKey();
    const args = [
      'set',
      '--file',
      '.env',
      '--replace-protected',
      'SM_MASTER_KEY',
      `SM_MASTER_KEY=${KEY_B}`,
    ];
    const none = await cli(args);
    expect(none).toMatchObject({
      code: 2,
      err: [
        'configure-env: --replace-protected needs a terminal to confirm; pass --ci to replace without one',
      ],
    });
    const ci = await cli([...args, '--ci', '--json']);
    expect(ci.code).toBe(0);
    expect(JSON.parse(ci.out[0]!).keys).toEqual([
      {
        key: 'SM_MASTER_KEY',
        status: 'updated',
        masked: '••••o=',
        replaced: true,
      },
    ]);
  });

  it('takes only a protected variable', async () => {
    const r = await cli([
      'set',
      '--file',
      '.env',
      '--create',
      '--replace-protected',
      'PORT',
      'SM_MASTER_KEY_FILE=/k',
    ]);
    expect(r).toMatchObject({
      code: 2,
      err: [
        'configure-env: PORT: --replace-protected takes a protected variable',
      ],
    });
    expect(
      (
        await cli([
          'unset',
          '--file',
          '.env',
          '--replace-protected',
          'NOPE',
          'X',
        ])
      ).code,
    ).toBe(2);
  });
});

describe('apply', () => {
  it('records the values it writes and finds', async () => {
    await writeFile(path('worker.env'), `SM_MASTER_KEY=${KEY_A}\n`);
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      '.env',
      '--file',
      'worker.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(r.code).toBe(0);
    // The held value went to .env.
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_A);
    const { fingerprints } = await state();
    expect(Object.keys(fingerprints).sort()).toEqual(['.env', 'worker.env']);
    await expectNoValue([r], KEY_A);
  });

  it('refuses to recreate a deleted file with a new --generate value', async () => {
    const first = await cli([
      'apply',
      '--ci',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(first.code).toBe(0);
    const old = (await valueIn('.env', 'SM_MASTER_KEY'))!;
    await rm(path('.env'));
    const again = await cli([
      'apply',
      '--ci',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(again).toMatchObject({ code: 2, out: [] });
    expect(again.err).toEqual([`configure-env: ${wasSet()}`]);
    expect(await exists('.env')).toBe(false);
    const json = await cli([
      'apply',
      '--ci',
      '--json',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      ok: false,
      errors: [
        {
          kind: 'protected',
          key: 'SM_MASTER_KEY',
          reason: REASON,
          message: `was set on ${today()}; restore it from your backup, or pass --replace-protected SM_MASTER_KEY`,
        },
      ],
    });
    // The restore path: the old value from the environment.
    const restored = await cli(['apply', '--ci', '--file', '.env'], {
      env: { SM_MASTER_KEY: old },
    });
    expect(restored.code).toBe(0);
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(old);
    await expectNoValue([first, again, json, restored], old);
  });

  it('refuses a generate file that would change the value, writing nothing', async () => {
    const files = ['--file', 'gen.env', '--file', '.env.example'];
    const first = await cli([
      'apply',
      '--ci',
      ...files,
      '--set',
      'API_KEY=first-value',
    ]);
    expect(first.code).toBe(0);
    const before = await Promise.all(['gen.env', '.env.example'].map(read));
    const changed = await cli([
      'apply',
      '--ci',
      '--json',
      ...files,
      '--set',
      'API_KEY=other-value',
      '--set',
      'PORT=9090',
    ]);
    expect(changed.code).toBe(2);
    expect(JSON.parse(changed.out[0]!).errors).toEqual([
      {
        kind: 'protected',
        key: 'API_KEY',
        message: 'is protected; pass --replace-protected API_KEY to change it',
      },
    ]);
    // Without a value, the default (none) would empty it.
    const emptied = await cli(['apply', '--ci', ...files]);
    expect(emptied.code).toBe(2);
    expect(emptied.err).toEqual([
      'configure-env: API_KEY: is protected; pass --replace-protected API_KEY to change it',
    ]);
    expect(await Promise.all(['gen.env', '.env.example'].map(read))).toEqual(
      before,
    );
    await expectNoValue([changed, emptied], 'first-value', 'other-value');
  });

  it('replaces with the flag under --ci, reporting it', async () => {
    await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=first-value',
    ]);
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=other-value',
      '--replace-protected',
      'API_KEY',
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: ['gen.env: updated', 'gen.env: replaced protected API_KEY'],
    });
    const json = await cli([
      'apply',
      '--ci',
      '--json',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=third-value',
      '--replace-protected',
      'API_KEY',
    ]);
    expect(JSON.parse(json.out[0]!).replaced).toEqual([
      { file: 'gen.env', key: 'API_KEY' },
    ]);
    expect(await valueIn('gen.env', 'API_KEY')).toBe('third-value');
  });

  it('asks for the key name in the terminal before replacing', async () => {
    await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=first-value',
    ]);
    const { prompts, calls } = scriptedPrompts({
      'Which files': ['gen.env'],
      'Type API_KEY': 'API_KEY',
      API_KEY: 'other-value',
    });
    const r = await cli(['apply', '--replace-protected', 'API_KEY'], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(calls.map((call) => call.message)).toContain(
      'Type API_KEY to replace its protected value',
    );
    expect(await valueIn('gen.env', 'API_KEY')).toBe('other-value');

    const refused = await cli(['apply'], {
      isTTY: true,
      prompts: scriptedPrompts({
        'Which files': ['gen.env'],
        API_KEY: 'third-value',
      }).prompts,
    });
    expect(refused.code).toBe(2);
    expect(await valueIn('gen.env', 'API_KEY')).toBe('other-value');
  });

  it('exits 1 for a state it cannot read, writing nothing', async () => {
    await mkdir(path('.configure-env'));
    await writeFile(path(STATE), '{"version": 2}');
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=first-value',
    ]);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      `configure-env: invalid state ${path(STATE)}: version: must be 1`,
    );
    expect(await exists('gen.env')).toBe(false);
  });

  it('exits 1 when the state cannot be written, saying what was', async () => {
    await mkdir(path('.configure-env'));
    await chmod(path('.configure-env'), 0o500);
    try {
      const r = await cli([
        'apply',
        '--ci',
        '--file',
        'gen.env',
        '--set',
        'API_KEY=first-value',
      ]);
      expect(r.code).toBe(1);
      expect(r.out).toEqual(['gen.env: created']);
      expect(r.err[0]).toMatch(
        /^configure-env: \.configure-env\/state\.json: not written: /,
      );
      expect(r.err[1]).toBe(
        'gen.env was written; its protected values are not recorded',
      );
      const set = await cli([
        'set',
        '--file',
        '.env',
        '--create',
        `SM_MASTER_KEY=${KEY_A}`,
      ]);
      expect(set.code).toBe(1);
      expect(set.err[1]).toBe(
        '.env was written; its protected values are not recorded',
      );
    } finally {
      await chmod(path('.configure-env'), 0o700);
    }
  });

  it('takes --state for another place', async () => {
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--state',
      'private/state.json',
      '--set',
      'API_KEY=first-value',
    ]);
    expect(r.code).toBe(0);
    expect(await exists(STATE)).toBe(false);
    expect(await exists('private/state.json')).toBe(true);
  });
});

describe('check and validate', () => {
  const mismatch = () =>
    `SM_MASTER_KEY no longer matches the value recorded on ${today()}`;

  it('report a value that no longer matches its fingerprint, never writing the state', async () => {
    await seedKey();
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_B}\n`);
    const before = await read(STATE);
    const validate = await cli(['validate', '--file', '.env']);
    expect(validate).toMatchObject({ code: 1, out: [`.env: ${mismatch()}`] });
    const json = await cli(['validate', '--json', '--file', '.env']);
    expect(JSON.parse(json.out[0]!).files[0].errors).toEqual([
      {
        kind: 'protected',
        key: 'SM_MASTER_KEY',
        message: `no longer matches the value recorded on ${today()}`,
        reason: REASON,
      },
    ]);
    const check = await cli(['check', '--ci', '--file', '.env']);
    expect(check.code).toBe(1);
    expect(check.out).toContain(`.env: ${mismatch()}`);
    const checkJson = await cli(['check', '--ci', '--json', '--file', '.env']);
    expect(JSON.parse(checkJson.out[0]!).files[0].protected).toEqual([
      {
        kind: 'protected',
        key: 'SM_MASTER_KEY',
        message: `no longer matches the value recorded on ${today()}`,
        reason: REASON,
      },
    ]);
    expect(await read(STATE)).toBe(before);
    await expectNoValue([validate, json, check, checkJson], KEY_A, KEY_B);
  });

  it('pass a matching value, an emptied one, and a missing state', async () => {
    await seedKey();
    expect((await cli(['validate', '--file', '.env'])).code).toBe(0);
    expect((await cli(['check', '--ci', '--file', '.env'])).code).toBe(0);
    await rm(path(STATE));
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_B}\n`);
    expect((await cli(['validate', '--file', '.env'])).code).toBe(0);
    expect(await exists(STATE)).toBe(false);
  });

  it('exit 1 for a state they cannot read', async () => {
    await mkdir(path('.configure-env'));
    await writeFile(path(STATE), 'nope');
    const r = await cli(['validate', '--file', '.env']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      `configure-env: invalid state ${path(STATE)}: is not valid JSON`,
    );
  });
});

describe('the comment line', () => {
  it('follows the requiredUnless line, and unset removes it with the key', async () => {
    await seedKey();
    expect(await read('.env')).toBe(
      `# required unless SM_MASTER_KEY_FILE is set\n# protected: ${REASON}\nSM_MASTER_KEY=${KEY_A}\n`,
    );
    await cli([
      'unset',
      '--ci',
      '--file',
      '.env',
      '--replace-protected',
      'SM_MASTER_KEY',
      'SM_MASTER_KEY',
    ]);
    expect(await read('.env')).toBe('');
  });

  it('is a bare `protected` without a reason, in created files too', async () => {
    await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=first-value',
    ]);
    expect(await read('gen.env')).toBe(
      '# protected\nAPI_KEY=first-value\nPORT=8080\n',
    );
  });
});
