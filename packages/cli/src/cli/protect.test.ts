// Protected variables: set, unset and apply never change a protected value
// silently, even after the file that held it was deleted.

import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vite-plus/test';
import {
  getValue,
  parseDotenv,
  updateState,
  writeState,
} from '@configure-env/core';
import {
  KEY_A,
  KEY_B,
  LEGACY_STATE,
  STATE,
  holdState,
  readState,
  run,
  scriptedPrompts,
  stateBytes,
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
      variables: ['SM_MASTER_KEY', 'SM_MASTER_KEY_FILE', 'API_KEY'],
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
const state = () => readState(path(STATE));
/** The state as text, for comparing it before and after a run. */
const snapshot = async () => JSON.stringify(await state());
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
    await stateBytes(path(STATE)),
  ].join('\n');
  for (const value of values) expect(text).not.toContain(value);
}

const PROTECTED = `configure-env: SM_MASTER_KEY: is protected (${REASON}); pass --replace-protected SM_MASTER_KEY to change it`;
const wasSet = () =>
  `SM_MASTER_KEY was set on ${today()}; restore it from your backup, or pass --replace-protected SM_MASTER_KEY`;

/** Runs whose state write fails, as a full disk would make it. */
const FAIL = {
  writeState: async () => {
    throw new Error('disk full');
  },
};

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

  it('records a replacement against the state as it is when written', async () => {
    await seedKey();
    // A parallel run replaces the value while this one waits on stdin; this
    // run then puts the first value back, which it read as recorded.
    const r = await cli(
      [
        'set',
        '--ci',
        '--file',
        '.env',
        '--replace-protected',
        'SM_MASTER_KEY',
        '--stdin',
        'SM_MASTER_KEY',
      ],
      {
        stdin: async () => {
          const other = await cli([
            'set',
            '--ci',
            '--file',
            '.env',
            '--replace-protected',
            'SM_MASTER_KEY',
            `SM_MASTER_KEY=${KEY_B}`,
          ]);
          expect(other.code).toBe(0);
          return KEY_A;
        },
      },
    );
    expect(r.code).toBe(0);
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_A);
    // The state follows the file: no mismatch.
    expect((await cli(['check', '--file', '.env'])).code).toBe(0);
  });

  it('keeps the fingerprints of parallel runs', async () => {
    const runs = await Promise.all(
      ['.env', 'worker.env'].map((file) =>
        cli(['set', '--create', '--file', file, '--stdin', 'SM_MASTER_KEY'], {
          stdin: KEY_A,
        }),
      ),
    );
    expect(runs.map((r) => r.code)).toEqual([0, 0]);
    expect(Object.keys((await state()).fingerprints).sort()).toEqual([
      '.env',
      'worker.env',
    ]);
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
    expect((await cli(['check', '--file', '.env'])).code).toBe(0);
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

  it('refuses a broken rule between variables before asking, writing nothing', async () => {
    await seedKey();
    const before = await read('.env');
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
        'SM_MASTER_KEY_FILE=/run/key',
      ],
      { isTTY: true, prompts },
    );
    expect(r).toMatchObject({
      code: 1,
      out: [],
      err: [
        'configure-env: SM_MASTER_KEY, SM_MASTER_KEY_FILE: set only one of them',
        'nothing was written to .env',
      ],
    });
    expect(calls).toEqual([]);
    expect(await read('.env')).toBe(before);
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
    await writeFile(path(LEGACY_STATE), '{"version": 2}');
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
      `configure-env: invalid state ${path(LEGACY_STATE)}: version: must be 1`,
    );
    expect(await exists('gen.env')).toBe(false);
  });

  it('exits 1 when the state cannot be written, saying what was', async () => {
    const r = await cli(
      ['apply', '--ci', '--file', 'gen.env', '--set', 'API_KEY=first-value'],
      FAIL,
    );
    expect(r.code).toBe(1);
    expect(r.out).toEqual(['gen.env: created']);
    expect(r.err[0]).toMatch(
      /^configure-env: \.configure-env\/state\.db: not written: disk full$/,
    );
    expect(r.err[1]).toBe(
      'gen.env was written; its protected values are not recorded',
    );
    const set = await cli(
      ['set', '--file', '.env', '--create', `SM_MASTER_KEY=${KEY_A}`],
      FAIL,
    );
    expect(set.code).toBe(1);
    expect(set.err[1]).toBe(
      '.env was written; its protected values are not recorded',
    );
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_A);
    await expectNoValue([r, set], 'first-value', KEY_A);
  });

  it('prints the set and unset documents with ok false when the state cannot be written', async () => {
    await seedKey();
    // A run whose state does not change writes no state.
    const set = await cli(
      ['set', '--json', '--file', '.env', 'SM_MASTER_KEY_FILE='],
      FAIL,
    );
    expect(set.code).toBe(0);
    const replaced = await cli(
      [
        'set',
        '--json',
        '--file',
        '.env',
        '--replace-protected',
        'SM_MASTER_KEY',
        `SM_MASTER_KEY=${KEY_B}`,
      ],
      FAIL,
    );
    expect(replaced.code).toBe(1);
    expect(replaced.err).toEqual([]);
    expect(JSON.parse(replaced.out[0]!)).toEqual({
      command: 'set',
      ok: false,
      file: '.env',
      keys: [
        {
          key: 'SM_MASTER_KEY',
          status: 'updated',
          masked: '••••o=',
          replaced: true,
        },
      ],
      errors: [
        {
          kind: 'file',
          path: '.configure-env/state.db',
          message:
            '.configure-env/state.db: not written: disk full; .env was written; its protected values are not recorded',
        },
      ],
    });
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_B);
    const unset = await cli(
      [
        'unset',
        '--json',
        '--file',
        '.env',
        '--replace-protected',
        'SM_MASTER_KEY',
        'SM_MASTER_KEY',
      ],
      FAIL,
    );
    expect(unset.code).toBe(1);
    expect(JSON.parse(unset.out[0]!)).toEqual({
      command: 'unset',
      ok: false,
      file: '.env',
      keys: [{ key: 'SM_MASTER_KEY', status: 'removed', replaced: true }],
      errors: [
        {
          kind: 'file',
          path: '.configure-env/state.db',
          message:
            '.configure-env/state.db: not written: disk full; .env was written; its protected values are not recorded',
        },
      ],
    });
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBeUndefined();
    await expectNoValue([set, replaced, unset], KEY_A, KEY_B);
  });

  it('fails before writing anything while another run holds the state', async () => {
    await seedKey();
    const release = await holdState(path(STATE));
    onTestFinished(release);
    const held = [
      '.configure-env/state.db: not written: in use by another run; try again',
      'nothing was written',
    ];
    const set = await cli(
      ['set', '--create', '--file', 'worker.env', '--stdin', 'SM_MASTER_KEY'],
      { stdin: KEY_A },
    );
    expect(set).toMatchObject({
      code: 1,
      out: [],
      err: [`configure-env: ${held[0]}`, held[1]],
    });
    const json = await cli(
      [
        'set',
        '--json',
        '--create',
        '--file',
        'worker.env',
        '--stdin',
        'SM_MASTER_KEY',
      ],
      { stdin: KEY_A },
    );
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out[0]!)).toEqual({
      command: 'set',
      ok: false,
      file: 'worker.env',
      keys: [],
      errors: [
        {
          kind: 'file',
          path: '.configure-env/state.db',
          message: held.join('; '),
        },
      ],
    });
    expect(await exists('worker.env')).toBe(false);
    const apply = await cli([
      'apply',
      '--ci',
      '--json',
      '--file',
      'gen.env',
      '--set',
      'API_KEY=first-value',
    ]);
    expect(apply.code).toBe(1);
    const document = JSON.parse(apply.out[0]!);
    expect(document).toMatchObject({
      ok: false,
      errors: [
        {
          kind: 'file',
          path: '.configure-env/state.db',
          message: held.join('; '),
        },
      ],
    });
    expect(
      document.files.map((file: { written: boolean }) => file.written),
    ).toEqual([false]);
    expect(await exists('gen.env')).toBe(false);
    // So does a run that only holds a protected value.
    const holding = await cli(['set', '--file', '.env', 'SM_MASTER_KEY_FILE=']);
    expect(holding.code).toBe(1);
    expect(holding.err[0]).toBe(`configure-env: ${held[0]}`);
    // A run that touches no protected value never opens the state.
    const other = await cli([
      'set',
      '--create',
      '--file',
      'gen.env',
      'PORT=9090',
    ]);
    expect(other.code).toBe(0);
  }, 15_000);

  it('checks every protected key of one run against the state', async () => {
    const both = (api: string) => [
      'set',
      '--create',
      '--file',
      '.env',
      `SM_MASTER_KEY=${KEY_A}`,
      `API_KEY=${api}`,
    ];
    expect((await cli(both('first-value'))).code).toBe(0);
    await rm(path('.env'));
    const r = await cli(both('other-value'));
    expect(r).toMatchObject({
      code: 2,
      err: [
        `configure-env: API_KEY was set on ${today()}; restore it from your backup, or pass --replace-protected API_KEY`,
        'nothing was written to .env',
      ],
    });
    expect(await exists('.env')).toBe(false);
    expect((await cli(both('first-value'))).code).toBe(0);
  });

  it('checks the same key in two files of one apply run', async () => {
    const files = ['--file', '.env', '--file', 'worker.env'];
    const first = await cli([
      'apply',
      '--ci',
      ...files,
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(first.code).toBe(0);
    const old = (await valueIn('.env', 'SM_MASTER_KEY'))!;
    expect(await valueIn('worker.env', 'SM_MASTER_KEY')).toBe(old);
    await rm(path('.env'));
    await rm(path('worker.env'));
    const again = await cli([
      'apply',
      '--ci',
      '--json',
      ...files,
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(again.code).toBe(2);
    expect(
      JSON.parse(again.out[0]!).errors.map((e: { key: string }) => e.key),
    ).toEqual(['SM_MASTER_KEY', 'SM_MASTER_KEY']);
    const restored = await cli(['apply', '--ci', ...files], {
      env: { SM_MASTER_KEY: old },
    });
    expect(restored.code).toBe(0);
    expect((await cli(['check', ...files])).code).toBe(0);
    await expectNoValue([first, again, restored], old);
  });

  it('checks in its transaction a state changed after the run read it', async () => {
    await seedKey();
    await rm(path('.env'));
    // While this run waits, another one records a new value for the key.
    const r = await cli(
      ['set', '--create', '--file', '.env', '--stdin', 'SM_MASTER_KEY'],
      {
        stdin: async () => {
          await updateState(path(STATE), [
            {
              action: 'record',
              file: '.env',
              key: 'SM_MASTER_KEY',
              value: KEY_B,
              replace: true,
            },
          ]);
          return KEY_A;
        },
      },
    );
    expect(r).toMatchObject({
      code: 2,
      err: [`configure-env: ${wasSet()}`, 'nothing was written to .env'],
    });
    expect(await exists('.env')).toBe(false);
  });

  it('records the values an existing create-only file holds', async () => {
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_A}\n`, { mode: 0o600 });
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({ code: 0, out: ['.env: skipped (exists)'] });
    expect(Object.keys((await state()).fingerprints)).toEqual(['.env']);
  });

  it('records the values a file whose mode it fixes holds', async () => {
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_A}\n`);
    await chmod(path('.env'), 0o644);
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: mode fixed (644 → 600)'],
    });
    expect(Object.keys((await state()).fingerprints)).toEqual(['.env']);
    expect((await stat(path('.env'))).mode & 0o777).toBe(0o600);
    await expectNoValue([r], KEY_A);
  });

  it('fixes the mode of a file whose protected value no longer matches, keeping the record', async () => {
    await seedKey();
    // A fixed record time near midnight UTC: the date is the UTC day.
    const seeded = await state();
    seeded.fingerprints['.env']!['SM_MASTER_KEY']!.recordedAt =
      '2020-01-02T23:59:30.000Z';
    await writeState(path(STATE), seeded);
    const recorded = await snapshot();
    // The value changed by hand: a chmod neither blocks on it nor records it.
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_B}\n`);
    await chmod(path('.env'), 0o644);
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: mode fixed (644 → 600)'],
      err: [],
    });
    expect((await stat(path('.env'))).mode & 0o777).toBe(0o600);
    expect(await valueIn('.env', 'SM_MASTER_KEY')).toBe(KEY_B);
    expect(await snapshot()).toBe(recorded);
    // check still reports the mismatch.
    const check = await cli(['check', '--ci', '--file', '.env']);
    expect(check.code).toBe(1);
    expect(check.out).toContain(
      `.env: SM_MASTER_KEY no longer matches the value recorded on 2020-01-02`,
    );
    // Just after midnight UTC too: local-time formatting fails on one side
    // of UTC or the other.
    const after = await state();
    after.fingerprints['.env']!['SM_MASTER_KEY']!.recordedAt =
      '2020-01-03T00:00:30.000Z';
    await writeState(path(STATE), after);
    const next = await cli(['check', '--ci', '--file', '.env']);
    expect(next.out).toContain(
      `.env: SM_MASTER_KEY no longer matches the value recorded on 2020-01-03`,
    );
    await expectNoValue([r, check, next], KEY_A, KEY_B);
  });

  it('takes --state for another place', async () => {
    const r = await cli([
      'apply',
      '--ci',
      '--file',
      'gen.env',
      '--state',
      'private/state.db',
      '--set',
      'API_KEY=first-value',
    ]);
    expect(r.code).toBe(0);
    expect(await exists(STATE)).toBe(false);
    expect(await exists('private/state.db')).toBe(true);
  });

  it('fixes a mode without the state when the file holds no protected value', async () => {
    await writeFile(path('.env'), 'SM_MASTER_KEY_FILE=/run/key\n');
    await chmod(path('.env'), 0o644);
    // Another run holds the state: a chmod with nothing to record never waits.
    onTestFinished(await holdState(path(STATE)));
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: mode fixed (644 → 600)'],
      err: [],
    });
    expect((await stat(path('.env'))).mode & 0o777).toBe(0o600);
    expect((await state()).fingerprints).toEqual({});
  });

  it('takes the state for a mode fix of a file holding a protected value', async () => {
    await seedKey();
    await chmod(path('.env'), 0o644);
    const recorded = await snapshot();
    onTestFinished(await holdState(path(STATE)));
    // As for a skipped create-only file: the held value is checked under it.
    const r = await cli(['apply', '--ci', '--file', '.env']);
    expect(r).toMatchObject({
      code: 1,
      out: [],
      err: [
        'configure-env: .configure-env/state.db: not written: in use by another run; try again',
        'nothing was written',
      ],
    });
    expect((await stat(path('.env'))).mode & 0o777).toBe(0o644);
    expect(await snapshot()).toBe(recorded);
    await expectNoValue([r], KEY_A);
  });
});

describe('check and protected values', () => {
  const mismatch = () =>
    `SM_MASTER_KEY no longer matches the value recorded on ${today()}`;

  it('report a value that no longer matches its fingerprint, never writing the state', async () => {
    await seedKey();
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_B}\n`);
    const before = await snapshot();
    const check = await cli(['check', '--ci', '--file', '.env']);
    expect(check).toMatchObject({
      code: 1,
      out: [`.env: ${mismatch()}`, '1 error, 0 warnings in 1 file'],
    });
    const json = await cli(['check', '--ci', '--json', '--file', '.env']);
    expect(JSON.parse(json.out[0]!).files[0].problems).toEqual([
      {
        severity: 'error',
        code: 'protected',
        key: 'SM_MASTER_KEY',
        message: `no longer matches the value recorded on ${today()}`,
        reason: REASON,
      },
    ]);
    expect(await snapshot()).toBe(before);
    await expectNoValue([check, json], KEY_A, KEY_B);
  });

  it('pass a matching value, an emptied one, and a missing state', async () => {
    await seedKey();
    expect((await cli(['check', '--file', '.env'])).code).toBe(0);
    expect(
      (await cli(['check', '--ci', '--json', '--file', '.env'])).code,
    ).toBe(0);
    await rm(path(STATE));
    await writeFile(path('.env'), `SM_MASTER_KEY=${KEY_B}\n`);
    expect((await cli(['check', '--file', '.env'])).code).toBe(0);
    expect(await exists(STATE)).toBe(false);
  });

  it('exit 1 for a state they cannot read', async () => {
    await mkdir(path('.configure-env'));
    await writeFile(path(LEGACY_STATE), 'nope');
    const r = await cli(['check', '--file', '.env']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      `configure-env: invalid state ${path(LEGACY_STATE)}: is not valid JSON`,
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
