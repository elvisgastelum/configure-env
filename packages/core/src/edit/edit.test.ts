import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import type { FileSpec } from '../schema/definition.ts';
import {
  DEFAULT_STATE_PATH,
  loadState,
  matchesFingerprint,
} from '../engine/state.ts';
import { schemaOf, useTempRoot } from '../engine/test-helpers.ts';
import {
  type EditContext,
  parsePairs,
  setValues,
  unsetValues,
} from './edit.ts';
import { type EnvFile, readEnvFile } from './file.ts';

const temp = useTempRoot();

/** One merge file over a commented, a secret protected and two exclusive keys. */
const schema = schemaOf({
  variables: {
    PORT: { type: 'port', default: 8080, comment: 'The port.' },
    MODE: { type: 'enum', values: ['dev', 'prod'] },
    TOKEN: {
      type: 'string',
      secret: true,
      minLength: 8,
      protected: { reason: 'sessions sign with it' },
    },
    KEY: { type: 'string', conflictsWith: 'KEY_FILE' },
    KEY_FILE: { type: 'string' },
  },
  files: [
    { path: 'app.env', policy: 'merge', variables: '*', header: 'The app.' },
  ],
});
const spec = schema.files[0] as FileSpec;

const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const appPath = () => join(temp.dirs.root, 'app.env');
const content = () => readFile(appPath(), 'utf8');

/** The context of a run, with the state as it is now. */
async function contextOf(extra: Partial<EditContext> = {}) {
  const state = await loadState(statePath());
  if (!state.ok) throw new Error(state.message);
  return {
    schema,
    run: { path: statePath(), state: state.state },
    cwd: temp.dirs.root,
    ...extra,
  };
}

/** app.env, written with `text` first unless it is undefined. */
async function fileOf(text?: string): Promise<EnvFile> {
  if (text !== undefined) await writeFile(appPath(), text);
  const result = await readEnvFile(temp.dirs.root, spec);
  if (!result.ok) throw new Error(result.message);
  return result.file;
}

const pairsOf = (record: Record<string, string>) =>
  new Map(Object.entries(record));

describe('parsePairs', () => {
  it('keeps the order, a later pair for a key replacing an earlier one', () => {
    const result = parsePairs(['A=1', 'B=x=y', 'A=2']);
    expect(result.ok && [...result.pairs]).toEqual([
      ['B', 'x=y'],
      ['A', '2'],
    ]);
  });

  it('refuses a pair without a key or a name that is not one', () => {
    expect(parsePairs(['=1'])).toEqual({
      ok: false,
      message: 'set takes KEY=VALUE, got =1',
    });
    expect(parsePairs(['NAME'])).toEqual({
      ok: false,
      message: 'set takes KEY=VALUE, got NAME',
    });
    expect(parsePairs(['1A=x'])).toEqual({
      ok: false,
      message: '1A: is not a valid variable name',
    });
  });
});

describe('setValues', () => {
  it('updates, adds and leaves keys, keeping every other byte', async () => {
    const file = await fileOf('# mine\r\nMODE=dev\r\n');
    const result = await setValues(
      await contextOf(),
      file,
      pairsOf({ MODE: 'prod', PORT: '9090', KEY: 'abc' }),
    );
    expect(result).toMatchObject({
      ok: true,
      file: 'app.env',
      replaced: [],
      keys: [
        { key: 'MODE', status: 'updated', plain: 'prod' },
        { key: 'PORT', status: 'added', plain: '9090' },
        { key: 'KEY', status: 'added', plain: 'abc' },
      ],
    });
    expect(await content()).toBe(
      '# mine\r\nMODE=prod\r\n\r\n# The port.\r\nPORT=9090\r\nKEY=abc\r\n',
    );
  });

  it('writes nothing when every value is unchanged', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf('MODE=dev\n'),
      pairsOf({ MODE: 'dev' }),
    );
    expect(result).toMatchObject({
      ok: true,
      keys: [{ key: 'MODE', status: 'unchanged' }],
    });
    expect(await content()).toBe('MODE=dev\n');
  });

  it('creates a missing file under its header', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf(),
      pairsOf({ MODE: 'dev' }),
    );
    expect(result.ok).toBe(true);
    expect(await content()).toBe('# The app.\n\nMODE=dev\n');
  });

  it('writes a key the file does not list as a plain string', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf(''),
      pairsOf({ EXTRA: 'two words' }),
    );
    expect(result).toMatchObject({
      ok: true,
      keys: [{ key: 'EXTRA', status: 'added', spec: { type: 'string' } }],
    });
    expect(await content()).toBe('EXTRA="two words"\n');
  });

  it('returns every invalid value and writes nothing', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf('MODE=dev\n'),
      pairsOf({ PORT: 'http', MODE: 'test' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'invalid') throw new Error('not invalid');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatch(/^PORT: /);
    expect(result.messages[1]).toMatch(/^MODE: /);
    expect(await content()).toBe('MODE=dev\n');
  });

  it('checks a kept value as it is, asking to unset it when invalid', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf('TOKEN=short\n'),
      pairsOf({ TOKEN: 'short' }),
      { kept: new Set(['TOKEN']) },
    );
    expect(result).toMatchObject({ ok: false, kind: 'invalid' });
    if (result.ok || result.kind !== 'invalid') return;
    expect(result.messages[0]).toMatch(
      /^TOKEN: .*; unset it to generate a new one$/,
    );
  });

  it('refuses a value that breaks a rule between variables', async () => {
    const result = await setValues(
      await contextOf(),
      await fileOf('KEY_FILE=/run/key\n'),
      pairsOf({ KEY: 'abc' }),
    );
    expect(result).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await content()).toBe('KEY_FILE=/run/key\n');
  });

  it('returns a write that fails, as when the file changed since it was read', async () => {
    const file = await fileOf('MODE=dev\n');
    await writeFile(appPath(), 'MODE=prod\n');
    const result = await setValues(
      await contextOf(),
      file,
      pairsOf({ PORT: '1' }),
    );
    expect(result).toMatchObject({ ok: false, kind: 'write' });
    if (result.ok || result.kind !== 'write') return;
    expect(result.message).toMatch(/^app\.env: not written: /);
    expect(await content()).toBe('MODE=prod\n');
  });

  describe('a protected variable', () => {
    it('records a new value in the state', async () => {
      const result = await setValues(
        await contextOf(),
        await fileOf(''),
        pairsOf({ TOKEN: 'secret-one' }),
      );
      expect(result).toMatchObject({ ok: true, replaced: [] });
      const state = await loadState(statePath());
      expect(
        state.ok &&
          matchesFingerprint(state.state, 'app.env', 'TOKEN', 'secret-one'),
      ).toBe(true);
    });

    it('refuses to change a value without replace', async () => {
      const result = await setValues(
        await contextOf(),
        await fileOf('TOKEN=secret-one\n'),
        pairsOf({ TOKEN: 'secret-two' }),
      );
      expect(result).toEqual({
        ok: false,
        kind: 'protected',
        problems: [
          {
            kind: 'protected',
            key: 'TOKEN',
            message:
              'is protected (sessions sign with it); pass --replace-protected TOKEN to change it',
            reason: 'sessions sign with it',
          },
        ],
      });
      expect(await content()).toBe('TOKEN=secret-one\n');
    });

    it('replaces it with replace, recording the new value', async () => {
      const result = await setValues(
        await contextOf(),
        await fileOf('TOKEN=secret-one\n'),
        pairsOf({ TOKEN: 'secret-two' }),
        { replace: new Set(['TOKEN']) },
      );
      expect(result).toMatchObject({ ok: true, replaced: ['TOKEN'] });
      expect(await content()).toBe('TOKEN=secret-two\n');
      const state = await loadState(statePath());
      expect(
        state.ok &&
          matchesFingerprint(state.state, 'app.env', 'TOKEN', 'secret-two'),
      ).toBe(true);
    });

    it('asks confirm for the replacements, writing nothing on a no', async () => {
      const asked: string[][] = [];
      const result = await setValues(
        await contextOf(),
        await fileOf('TOKEN=secret-one\n'),
        pairsOf({ TOKEN: 'secret-two' }),
        {
          replace: new Set(['TOKEN']),
          confirm: async (keys) => {
            asked.push(keys);
            return false;
          },
        },
      );
      expect(asked).toEqual([['TOKEN']]);
      expect(result).toEqual({ ok: false, kind: 'cancelled' });
      expect(await content()).toBe('TOKEN=secret-one\n');
    });

    it('returns a state it cannot write after writing the file', async () => {
      const result = await setValues(
        await contextOf({
          writeState: async () => {
            throw new Error('disk full');
          },
        }),
        await fileOf(''),
        pairsOf({ TOKEN: 'secret-one' }),
      );
      expect(result).toMatchObject({
        ok: true,
        stateError: [
          `${DEFAULT_STATE_PATH}: not written: disk full`,
          'app.env was written; its protected values are not recorded',
        ],
      });
      // A new protected key carries its reason as its comment.
      expect(await content()).toBe(
        '# protected: sessions sign with it\nTOKEN=secret-one\n',
      );
    });
  });
});

describe('unsetValues', () => {
  it('removes each key with its comment, reporting absent ones', async () => {
    const result = await unsetValues(
      await contextOf(),
      await fileOf('MODE=dev\n\n# The port.\nPORT=1\n'),
      ['PORT', 'NOPE'],
    );
    expect(result).toEqual({
      ok: true,
      file: 'app.env',
      replaced: [],
      keys: [
        { key: 'PORT', status: 'removed' },
        { key: 'NOPE', status: 'absent' },
      ],
    });
    expect(await content()).toBe('MODE=dev\n');
  });

  it('refuses to remove a protected value without replace', async () => {
    const result = await unsetValues(
      await contextOf(),
      await fileOf('TOKEN=secret-one\n'),
      ['TOKEN'],
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'protected',
      problems: [{ key: 'TOKEN' }],
    });
    expect(await content()).toBe('TOKEN=secret-one\n');
  });

  it('removes it with replace', async () => {
    const result = await unsetValues(
      await contextOf(),
      await fileOf('TOKEN=secret-one\n'),
      ['TOKEN'],
      { replace: new Set(['TOKEN']) },
    );
    expect(result).toMatchObject({ ok: true, replaced: ['TOKEN'] });
    expect(await content()).toBe('');
  });
});
