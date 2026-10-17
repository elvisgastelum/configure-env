// set, get and unset: single-variable edits that keep every other byte.

import {
  chmod,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vite-plus/test';
import { CliError } from './common.ts';
import { MIN_GENERATED_BYTES, MIN_GENERATED_LENGTH } from './generate.ts';
import { readStream } from './stdin.ts';
import {
  CLI_SCHEMA,
  KEY_A,
  KEY_B,
  RULES_SCHEMA,
  run,
  scriptedPrompts,
  useProject,
} from './test-helpers.ts';

/** One file to edit and its template. */
const EDIT_SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 8080, comment: 'The port.' },
    TOKEN: {
      type: 'string',
      secret: true,
      minLength: 8,
      description: 'API token',
      comment: 'API token.\n\nKeep it safe.',
    },
    MODE: { type: 'enum', values: ['dev', 'prod'], default: 'dev' },
    GREETING: { type: 'string' },
    DEBUG: { type: 'boolean' },
  },
  files: [
    { path: 'app.env', policy: 'merge', mode: '600', variables: '*' },
    { path: 'app.env.example', policy: 'merge', variables: '*' },
  ],
};

const dirs = useProject(EDIT_SCHEMA);
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const path = (name: string) => join(dirs.root, name);
const read = (name: string) => readFile(path(name), 'utf8');
const modeOf = async (name: string) => (await stat(path(name))).mode & 0o777;

// CRLF line endings, an export prefix, spacing, an inline comment and a
// custom comment: everything set must leave alone.
const ORIGINAL =
  '# My settings\r\nexport PORT = 8080 # inline\r\n\r\n# mine\r\nMODE=dev\r\nGREETING="hello world"\r\n';

const seed = async (content = ORIGINAL, mode = 0o640) => {
  await writeFile(path('app.env'), content, { mode });
  await chmod(path('app.env'), mode);
};

describe('set', () => {
  it('edits a value in place, keeping every other byte and the mode', async () => {
    await seed();
    const r = await cli(['set', 'PORT=9090']);
    expect(r).toMatchObject({
      code: 0,
      err: [],
      out: ['PORT: updated (9090)'],
    });
    expect(await read('app.env')).toBe(
      ORIGINAL.replace('PORT = 8080 #', 'PORT = 9090 #'),
    );
    expect(await modeOf('app.env')).toBe(0o640);
  });

  it('appends a missing key with its schema comment', async () => {
    await seed('PORT=1\n');
    const r = await cli(['set', 'TOKEN=abcdefghij', 'MODE=prod']);
    expect(r.code).toBe(0);
    expect(r.out).toEqual(['TOKEN: added (••••ij)', 'MODE: added (prod)']);
    expect(await read('app.env')).toBe(
      'PORT=1\n\n# API token.\n#\n# Keep it safe.\nTOKEN=abcdefghij\nMODE=prod\n',
    );
  });

  it('writes the value as the engine formats it', async () => {
    await seed('GREETING=x\nDEBUG=false\n');
    await cli(['set', 'GREETING=it costs $5', 'DEBUG=yes']);
    expect(await read('app.env')).toBe("GREETING='it costs $5'\nDEBUG=true\n");
  });

  it('reports an equal value as unchanged and leaves the file alone', async () => {
    await seed();
    const before = await stat(path('app.env'));
    const r = await cli(['set', 'MODE=dev', 'GREETING=hello world']);
    expect(r.out).toEqual([
      'MODE: unchanged (dev)',
      'GREETING: unchanged (hello world)',
    ]);
    expect(await read('app.env')).toBe(ORIGINAL);
    expect((await stat(path('app.env'))).ino).toBe(before.ino);
  });

  it('writes nothing when any value is invalid, never echoing it', async () => {
    await seed();
    const r = await cli(['set', 'PORT=9090', 'TOKEN=short']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('TOKEN: must be at least 8 characters');
    expect([...r.out, ...r.err].join('\n')).not.toContain('short');
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('refuses an unknown key unless --allow-unknown', async () => {
    await seed('PORT=1\n');
    const refused = await cli(['set', 'EXTRA=a b']);
    expect(refused.code).toBe(1);
    expect(refused.err.join('\n')).toContain(
      'EXTRA: is not a variable of app.env',
    );
    expect(await read('app.env')).toBe('PORT=1\n');
    const r = await cli(['set', '--allow-unknown', 'EXTRA=a b']);
    expect(r).toMatchObject({ code: 0, out: ['EXTRA: added (a b)'] });
    expect(await read('app.env')).toBe('PORT=1\nEXTRA="a b"\n');
  });

  it('exits 2 on a malformed pair or no pair at all', async () => {
    await seed();
    expect((await cli(['set', 'PORT'])).code).toBe(2);
    expect((await cli(['set'])).code).toBe(2);
    expect((await cli(['set', '1BAD=x', '--allow-unknown'])).code).toBe(2);
  });

  it('creates a missing file only with --create, with the schema mode', async () => {
    const r = await cli(['set', 'PORT=9090']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('--create');
    expect(await readdir(dirs.root)).toEqual(['env.schema.json']);
    const created = await cli(['set', '--create', 'PORT=9090']);
    expect(created).toMatchObject({ code: 0, out: ['PORT: added (9090)'] });
    expect(await read('app.env')).toBe('# The port.\nPORT=9090\n');
    expect(await modeOf('app.env')).toBe(0o600);
  });

  it('prompts for --prompt keys in a terminal, hiding secrets', async () => {
    await seed('PORT=1\n');
    const { prompts, calls } = scriptedPrompts({
      TOKEN: 'prompted-secret',
      PORT: '7000',
    });
    const r = await cli(['set', '--prompt', 'TOKEN', '--prompt', 'PORT'], {
      isTTY: true,
      prompts,
    });
    expect(r.code).toBe(0);
    expect(calls.map((c) => [c.kind, c.message])).toEqual([
      ['password', 'API token (TOKEN)'],
      ['text', 'PORT'],
    ]);
    expect(r.out.join('\n')).not.toContain('prompted-secret');
    expect(await read('app.env')).toContain('TOKEN=prompted-secret\n');
    expect(await read('app.env')).toContain('PORT=7000\n');
  });

  it('exits 2 for --prompt without a terminal, and 130 on cancel', async () => {
    await seed();
    expect((await cli(['set', '--prompt', 'PORT'])).code).toBe(2);
    const { prompts } = scriptedPrompts({ PORT: 'cancel' });
    const r = await cli(['set', '--prompt', 'PORT'], { isTTY: true, prompts });
    expect(r.code).toBe(130);
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('prints one JSON document with --json, masking secrets', async () => {
    await seed('PORT=1\n');
    const r = await cli(['set', '--json', 'TOKEN=abcdefghij', 'PORT=2']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.join(''))).toEqual({
      command: 'set',
      ok: true,
      file: 'app.env',
      keys: [
        { key: 'TOKEN', status: 'added', masked: '••••ij' },
        { key: 'PORT', status: 'updated', value: '2' },
      ],
    });
    expect(r.out.join('')).not.toContain('abcdefghij');
  });

  it('guards template files behind --allow-template', async () => {
    await writeFile(path('app.env.example'), 'PORT=1\n');
    const r = await cli(['set', '--file', 'app.env.example', 'PORT=2']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('--allow-template');
    expect(await read('app.env.example')).toBe('PORT=1\n');
    const allowed = await cli([
      'set',
      '--file',
      'app.env.example',
      '--allow-template',
      'PORT=2',
    ]);
    expect(allowed.code).toBe(0);
    expect(await read('app.env.example')).toBe('PORT=2\n');
  });

  it('never writes --generate or --stdin to a template, even with --allow-template', async () => {
    await writeFile(path('app.env.example'), 'PORT=1\n');
    const template = ['--file', 'app.env.example', '--allow-template'];
    for (const args of [
      ['--generate', 'TOKEN'],
      ['--stdin', 'TOKEN'],
    ]) {
      const r = await cli(['set', ...template, ...args], {
        stdin: 'abcdefghij',
      });
      expect(r.code).toBe(2);
      expect(r.err).toEqual([
        'configure-env: --generate and --stdin never write to a template such as app.env.example',
      ]);
    }
    expect(await read('app.env.example')).toBe('PORT=1\n');
  });
});

/** Replaces the schema with EDIT_SCHEMA, its TOKEN changed by `token`. */
const tokenSchema = (token: Record<string, unknown>) =>
  writeFile(
    path('env.schema.json'),
    JSON.stringify({
      ...EDIT_SCHEMA,
      variables: { ...EDIT_SCHEMA.variables, TOKEN: token },
    }),
  );

/** The TOKEN value the file holds. */
const tokenIn = async (name: string) =>
  /^TOKEN=(.*)$/m.exec(await read(name))?.[1];

describe('set --generate', () => {
  it('writes a random secret that passes its rules, never printing it', async () => {
    await seed('PORT=1\n');
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r.code).toBe(0);
    const value = (await tokenIn('app.env'))!;
    expect(value).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(r.out).toEqual([`TOKEN: added (••••${value.slice(-2)})`]);
    expect([...r.out, ...r.err].join('\n')).not.toContain(value);
  });

  it('creates the file with --create and masks the value in JSON', async () => {
    const r = await cli(['set', '--create', '--json', '--generate', 'TOKEN']);
    expect(r.code).toBe(0);
    const value = (await tokenIn('app.env'))!;
    expect(JSON.parse(r.out.join(''))).toEqual({
      command: 'set',
      ok: true,
      file: 'app.env',
      keys: [
        { key: 'TOKEN', status: 'added', masked: `••••${value.slice(-2)}` },
      ],
    });
    expect([...r.out, ...r.err].join('\n')).not.toContain(value);
    expect(await modeOf('app.env')).toBe(0o600);
  });

  it('keeps a value that is set, and fills an empty one', async () => {
    await seed('TOKEN=abcdefghij\n');
    const kept = await cli(['set', '--generate', 'TOKEN']);
    expect(kept).toMatchObject({ code: 0, out: ['TOKEN: unchanged (••••ij)'] });
    expect(await read('app.env')).toBe('TOKEN=abcdefghij\n');
    await seed('TOKEN=\n');
    const filled = await cli(['set', '--generate', 'TOKEN']);
    expect(filled.out[0]).toMatch(/^TOKEN: updated/);
    expect(await tokenIn('app.env')).toMatch(/^[A-Za-z0-9_-]{48}$/);
  });

  it('keeps a valid value byte for byte, however it is written', async () => {
    const line = "export TOKEN = 'abcdefghij' # kept\n";
    await seed(line);
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r).toMatchObject({ code: 0, out: ['TOKEN: unchanged (••••ij)'] });
    expect(await read('app.env')).toBe(line);
  });

  it('exits 1 for a value it would keep that breaks the rules, never echoing it', async () => {
    await seed('TOKEN=short\n');
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: TOKEN: must be at least 8 characters; unset it to generate a new one',
      'nothing was written to app.env',
    ]);
    expect([...r.out, ...r.err].join('\n')).not.toContain('short');
    expect(await read('app.env')).toBe('TOKEN=short\n');
  });

  it('raises the length to minLength and lowers it to maxLength', async () => {
    await seed('PORT=1\n');
    await tokenSchema({ type: 'string', secret: true, minLength: 64 });
    await cli(['set', '--generate', 'TOKEN']);
    expect(await tokenIn('app.env')).toHaveLength(64);
    await seed('PORT=1\n');
    await tokenSchema({ type: 'string', secret: true, maxLength: 20 });
    await cli(['set', '--generate', 'TOKEN']);
    expect(await tokenIn('app.env')).toHaveLength(20);
  });

  it.each([
    ['base64', 32, /^[A-Za-z0-9+/]{43}=$/],
    ['base64url', 32, /^[A-Za-z0-9_-]{43}$/],
    ['hex', 16, /^[0-9a-f]{32}$/],
  ])(
    'writes random bytes in the %s encoding',
    async (encoding, bytes, shape) => {
      await seed('PORT=1\n');
      await tokenSchema({
        type: 'string',
        secret: true,
        encoding,
        ...(encoding === 'hex' ? { bytes } : {}),
      });
      const r = await cli(['set', '--generate', 'TOKEN']);
      expect(r.code).toBe(0);
      const value = (await tokenIn('app.env'))!;
      expect(value).toMatch(shape);
      expect(Buffer.from(value, encoding as BufferEncoding)).toHaveLength(
        bytes,
      );
      expect([...r.out, ...r.err].join('\n')).not.toContain(value);
    },
  );

  it('exits 2 for bytes below the floor, writing nothing', async () => {
    await seed();
    await tokenSchema({
      type: 'string',
      secret: true,
      encoding: 'base64',
      bytes: MIN_GENERATED_BYTES - 1,
    });
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r).toMatchObject({
      code: 2,
      err: [
        `configure-env: TOKEN: bytes ${MIN_GENERATED_BYTES - 1} is too short for a generated secret; set it with --prompt or --stdin`,
      ],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 2 for a maxLength below the floor, writing nothing', async () => {
    await seed();
    await tokenSchema({
      type: 'string',
      secret: true,
      maxLength: MIN_GENERATED_LENGTH - 1,
    });
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r).toMatchObject({
      code: 2,
      err: [
        `configure-env: TOKEN: maxLength ${MIN_GENERATED_LENGTH - 1} is too short for a generated secret; set it with --prompt or --stdin`,
      ],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
    await tokenSchema({
      type: 'string',
      secret: true,
      maxLength: MIN_GENERATED_LENGTH,
    });
    expect((await cli(['set', '--generate', 'TOKEN'])).code).toBe(0);
    expect(await tokenIn('app.env')).toHaveLength(MIN_GENERATED_LENGTH);
  });

  it('exits 1 and writes nothing when no value passes the rules', async () => {
    await seed();
    await tokenSchema({ type: 'string', secret: true, pattern: '^[0-9]+$' });
    const r = await cli(['set', '--generate', 'TOKEN']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: TOKEN: cannot generate a value that passes its rules; set it with --prompt or --stdin',
    ]);
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 2 for a variable that is not a secret string', async () => {
    await seed();
    const plain = await cli(['set', '--generate', 'GREETING']);
    expect(plain.code).toBe(2);
    expect(plain.err).toEqual([
      'configure-env: GREETING: --generate takes a secret string variable',
    ]);
    await tokenSchema({ type: 'integer', secret: true });
    expect((await cli(['set', '--generate', 'TOKEN'])).code).toBe(2);
    expect(
      await cli(['set', '--generate', 'EXTRA', '--allow-unknown']),
    ).toMatchObject({
      code: 2,
      err: ['configure-env: EXTRA: is not declared in the schema'],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 2 for a key also given as KEY=VALUE or --prompt', async () => {
    await seed();
    const pair = await cli(['set', 'TOKEN=abcdefghij', '--generate', 'TOKEN']);
    expect(pair.code).toBe(2);
    expect(pair.err.join('\n')).not.toContain('abcdefghij');
    const { prompts } = scriptedPrompts();
    const prompt = await cli(
      ['set', '--prompt', 'TOKEN', '--generate', 'TOKEN'],
      { isTTY: true, prompts },
    );
    expect(prompt.code).toBe(2);
    expect(await read('app.env')).toBe(ORIGINAL);
  });
});

describe('set --stdin', () => {
  it('reads the value from stdin, stripping one trailing newline', async () => {
    await seed('PORT=1\n');
    const r = await cli(['set', '--stdin', 'TOKEN'], {
      stdin: 'abcdefghij\r\n',
    });
    expect(r).toMatchObject({ code: 0, out: ['TOKEN: added (••••ij)'] });
    expect(await tokenIn('app.env')).toBe('abcdefghij');
    await cli(['set', '--stdin', 'GREETING'], { stdin: 'hi\n\n' });
    expect(await read('app.env')).toContain('GREETING="hi\\n"\n');
  });

  it('masks a piped value even for a key that is not secret', async () => {
    await seed('PORT=1\n');
    const text = await cli(['set', '--stdin', 'GREETING'], {
      stdin: 'piped-from-a-vault\n',
    });
    expect(text).toMatchObject({ code: 0, out: ['GREETING: added (••••lt)'] });
    const json = await cli(['set', '--json', '--stdin', 'GREETING'], {
      stdin: 'another-vault-value',
    });
    expect(json.out.join('')).not.toContain('vault');
    expect(JSON.parse(json.out.join('')).keys[0]).toMatchObject({
      key: 'GREETING',
      masked: '••••ue',
    });
  });

  it('exits 2 when stdin is a terminal or cannot be read', async () => {
    await seed();
    const none = await cli(['set', '--stdin', 'TOKEN']);
    expect(none).toMatchObject({
      code: 2,
      err: [
        'configure-env: --stdin needs readStdin in the io passed to main()',
      ],
    });
    const tty = await cli(['set', '--stdin', 'TOKEN'], {
      stdin: 'abcdefghij',
      stdinIsTTY: true,
    });
    expect(tty).toMatchObject({
      code: 2,
      err: [
        'configure-env: --stdin reads the value from a pipe; stdin is a terminal',
      ],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 2 for a repeated --stdin, writing nothing', async () => {
    await seed();
    const r = await cli(['set', '--stdin', 'TOKEN', '--stdin', 'GREETING'], {
      stdin: 'abcdefghij',
    });
    expect(r).toMatchObject({
      code: 2,
      err: ['configure-env: --stdin takes one key; stdin holds one value'],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 2 with --prompt, or a key also given another way', async () => {
    await seed();
    const stdin = 'abcdefghij';
    const given = [
      ['TOKEN=abcdefghij', '--stdin', 'TOKEN'],
      ['--generate', 'TOKEN', '--stdin', 'TOKEN'],
      ['--prompt', 'PORT', '--stdin', 'TOKEN'],
    ];
    for (const args of given)
      expect((await cli(['set', ...args], { stdin })).code).toBe(2);
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 1 and writes nothing for an empty stdin, as a failed pipe gives', async () => {
    await seed();
    for (const stdin of ['', '\n', '\r\n']) {
      const r = await cli(['set', '--create', '--stdin', 'GREETING'], {
        stdin,
      });
      expect(r.code).toBe(1);
      expect(r.err).toEqual([
        'configure-env: GREETING: stdin was empty; nothing was written to app.env',
      ]);
    }
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits with the code of a failed read and writes nothing', async () => {
    await seed();
    // The errors readStream itself rejects with, so no message is copied.
    const failed = (limits: Parameters<typeof readStream>[1], input = '') => {
      const stream = new PassThrough();
      const read = readStream(stream, limits);
      if (input) stream.write(input);
      return read.then(
        () => new Error('read did not fail'),
        (error: unknown) => error as CliError,
      );
    };
    const failures = [
      await failed({ maxBytes: 1 }, 'ab'),
      await failed({ idleMs: 1 }),
    ];
    expect(failures.map((error) => (error as CliError).code)).toEqual([1, 2]);
    for (const stdin of failures as CliError[]) {
      const r = await cli(['set', '--stdin', 'TOKEN'], { stdin });
      expect(r).toMatchObject({
        code: stdin.code,
        out: [],
        err: [`configure-env: ${stdin.lines[0]}`],
      });
    }
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('exits 1 with a clear message when the reader fails on its own', async () => {
    await seed();
    const r = await cli(['set', '--stdin', 'TOKEN'], {
      stdin: new Error('EIO: i/o error, read'),
    });
    expect(r).toMatchObject({
      code: 1,
      out: [],
      err: ['configure-env: --stdin could not be read: EIO: i/o error, read'],
    });
    expect(await read('app.env')).toBe(ORIGINAL);
  });

  it('reads the file after stdin, so a change made while it waits survives', async () => {
    await seed('PORT=1\n');
    // Another command edits the file while this one waits on the pipe.
    const stdin = async () => {
      await writeFile(path('app.env'), 'PORT=1\nMODE=prod\n');
      return 'abcdefghij\n';
    };
    const r = await cli(['set', '--stdin', 'TOKEN'], { stdin });
    expect(r).toMatchObject({ code: 0, out: ['TOKEN: added (••••ij)'] });
    expect(await read('app.env')).toMatch(/^PORT=1\nMODE=prod\n/);
    expect(await tokenIn('app.env')).toBe('abcdefghij');
  });

  it('writes nothing for an invalid value, never echoing it', async () => {
    await seed();
    const r = await cli(['set', '--stdin', 'TOKEN'], { stdin: 'short\n' });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('TOKEN: must be at least 8 characters');
    expect([...r.out, ...r.err].join('\n')).not.toContain('short');
    expect(await read('app.env')).toBe(ORIGINAL);
  });
});

describe('the --file choice', () => {
  it('is required when the schema has more than one non-template file', async () => {
    await writeFile(path('env.schema.json'), JSON.stringify(CLI_SCHEMA));
    await writeFile(path('shared.env'), 'PORT=1\n');
    const r = await cli(['set', 'PORT=2']);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toMatch(/--file.*config\/app\.env.*shared\.env/s);
    const chosen = await cli(['set', '--file', 'shared.env', 'PORT=2']);
    expect(chosen.code).toBe(0);
    expect(await read('shared.env')).toBe('PORT=2\n');
  });

  it('takes one path only', async () => {
    const r = await cli([
      'get',
      'PORT',
      '--file',
      'app.env',
      '--file',
      'app.env',
    ]);
    expect(r.code).toBe(2);
  });
});

describe('get', () => {
  it('prints the unquoted value', async () => {
    await seed();
    expect(await cli(['get', 'GREETING'])).toMatchObject({
      code: 0,
      out: ['hello world'],
    });
    expect((await cli(['get', 'PORT'])).out).toEqual(['8080']);
  });

  it('refuses a secret with a hint unless --reveal', async () => {
    await seed('TOKEN=abcdefghij\n');
    const r = await cli(['get', 'TOKEN']);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.err.join('\n')).toContain('--reveal');
    expect(r.err.join('\n')).not.toContain('abcdefghij');
    expect(await cli(['get', 'TOKEN', '--reveal'])).toMatchObject({
      code: 0,
      out: ['abcdefghij'],
    });
  });

  it('exits 1 for a key that is not set, or a missing file', async () => {
    await seed();
    const r = await cli(['get', 'TOKEN']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('TOKEN: is not set in app.env');
    await writeFile(path('env.schema.json'), JSON.stringify(EDIT_SCHEMA));
    expect((await cli(['get', 'PORT', '--file', 'app.env.example'])).code).toBe(
      1,
    );
  });

  it('exits 2 without exactly one key', async () => {
    await seed();
    expect((await cli(['get'])).code).toBe(2);
    expect((await cli(['get', 'PORT', 'MODE'])).code).toBe(2);
  });

  it('prints JSON with the value, masked for a secret', async () => {
    await seed('TOKEN=abcdefghij\nPORT=1\n');
    const json = async (...args: string[]) => {
      const r = await cli(['get', '--json', ...args]);
      return { code: r.code, doc: JSON.parse(r.out.join('')) as unknown };
    };
    expect(await json('PORT')).toEqual({
      code: 0,
      doc: { key: 'PORT', value: '1', set: true },
    });
    expect(await json('TOKEN')).toEqual({
      code: 0,
      doc: { key: 'TOKEN', masked: '••••ij', set: true },
    });
    expect(await json('TOKEN', '--reveal')).toEqual({
      code: 0,
      doc: { key: 'TOKEN', value: 'abcdefghij', set: true },
    });
    expect(await json('MODE')).toEqual({
      code: 1,
      doc: { key: 'MODE', set: false },
    });
  });
});

describe('unset', () => {
  it('removes the key and its schema comment, keeping every other byte', async () => {
    const content =
      'PORT=1\n\n# API token.\n#\n# Keep it safe.\nTOKEN=abcdefghij\nMODE=dev\n';
    await seed(content);
    const r = await cli(['unset', 'TOKEN']);
    expect(r).toMatchObject({ code: 0, out: ['TOKEN: removed'] });
    expect(await read('app.env')).toBe('PORT=1\nMODE=dev\n');
    expect(await modeOf('app.env')).toBe(0o640);
  });

  it('keeps a comment that is not the schema comment', async () => {
    await seed(ORIGINAL);
    const r = await cli(['unset', 'MODE', 'PORT']);
    expect(r.out).toEqual(['MODE: removed', 'PORT: removed']);
    expect(await read('app.env')).toBe(
      '# My settings\r\n\r\n# mine\r\nGREETING="hello world"\r\n',
    );
  });

  it('removes a schema comment only when it is attached', async () => {
    await seed('# The port.\n\nPORT=1\n');
    await cli(['unset', 'PORT']);
    expect(await read('app.env')).toBe('# The port.\n');
  });

  it('keeps a longer comment block that only ends with the schema comment', async () => {
    await seed('# my note\n# The port.\nPORT=1\n');
    await cli(['unset', 'PORT']);
    expect(await read('app.env')).toBe('# my note\n# The port.\n');
  });

  it('reports an absent key, exit 0, writing nothing', async () => {
    await seed();
    const before = await stat(path('app.env'));
    const r = await cli(['unset', 'TOKEN']);
    expect(r).toMatchObject({ code: 0, out: ['TOKEN: absent'] });
    expect((await stat(path('app.env'))).ino).toBe(before.ino);
    expect(await cli(['unset', '--json', 'TOKEN'])).toMatchObject({
      code: 0,
      out: [
        JSON.stringify({
          command: 'unset',
          ok: true,
          file: 'app.env',
          keys: [{ key: 'TOKEN', status: 'absent' }],
        }),
      ],
    });
  });

  it('guards template files and needs a key', async () => {
    await writeFile(path('app.env.example'), 'PORT=1\n');
    expect(
      (await cli(['unset', '--file', 'app.env.example', 'PORT'])).code,
    ).toBe(2);
    expect((await cli(['unset'])).code).toBe(2);
    const r = await cli([
      'unset',
      '--file',
      'app.env.example',
      '--allow-template',
      'PORT',
    ]);
    expect(r.code).toBe(0);
    expect(await read('app.env.example')).toBe('');
  });
});

describe('unset cleans up the blank lines', () => {
  /** Comments, groups and a header, as apply writes them. */
  const CLEAN_SCHEMA = {
    version: 1,
    variables: {
      PORT: { type: 'port', default: 3000, group: 'web', comment: 'HTTP port' },
      HOST: { type: 'string', default: 'localhost', group: 'web' },
      API_TOKEN: {
        type: 'string',
        secret: true,
        group: 'auth',
        comment: 'tok',
      },
      MODE: {
        type: 'enum',
        values: ['dev', 'prod'],
        default: 'dev',
        group: 'auth',
      },
      DEBUG: { type: 'boolean', default: false },
    },
    files: [
      {
        path: '.env',
        policy: 'create-only',
        header: 'App settings',
        variables: '*',
      },
    ],
  };
  const useSchema = (schema: unknown) =>
    writeFile(path('env.schema.json'), JSON.stringify(schema));
  const without = (key: string) => ({
    ...CLEAN_SCHEMA,
    variables: Object.fromEntries(
      Object.entries(CLEAN_SCHEMA.variables).filter(([name]) => name !== key),
    ),
  });

  it('removes the blank line the block was set apart by', async () => {
    await useSchema({
      version: 1,
      variables: {
        PORT: { type: 'port', comment: 'HTTP port' },
        API_TOKEN: { type: 'string', secret: true, comment: 'tok' },
        DEBUG: { type: 'boolean' },
      },
      files: [{ path: '.env', policy: 'create-only', variables: '*' }],
    });
    await writeFile(
      path('.env'),
      '# HTTP port\nPORT=3000\n\n# tok\nAPI_TOKEN=x\nDEBUG=false\n',
    );
    expect((await cli(['unset', 'API_TOKEN'])).code).toBe(0);
    expect(await read('.env')).toBe('# HTTP port\nPORT=3000\nDEBUG=false\n');
  });

  it('keeps CRLF line endings', async () => {
    await seed('MODE=dev\r\n\r\n# The port.\r\nPORT=1\r\nDEBUG=true\r\n');
    await cli(['unset', 'PORT']);
    expect(await read('app.env')).toBe('MODE=dev\r\nDEBUG=true\r\n');
  });

  it('keeps a comment that is not the schema comment, with its blank line', async () => {
    await seed('MODE=dev\n\n# mine\nPORT=1\n');
    await cli(['unset', 'PORT']);
    expect(await read('app.env')).toBe('MODE=dev\n\n# mine\n');
  });

  it.each(Object.keys(CLEAN_SCHEMA.variables))(
    'leaves what a fresh apply writes without %s',
    async (key) => {
      await useSchema(CLEAN_SCHEMA);
      await cli(['apply', '--ci']);
      expect((await cli(['unset', key])).code).toBe(0);
      const unset = await read('.env');
      await rm(path('.env'));
      await useSchema(without(key));
      await cli(['apply', '--ci']);
      expect(unset).toBe(await read('.env'));
    },
  );
});

describe('help', () => {
  it.each(['set', 'get', 'unset'])('prints the help of %s', async (command) => {
    const r = await cli([command, '--help']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toMatch(
      new RegExp(`^Usage: configure-env ${command}`),
    );
    expect(r.out.join('\n')).toContain('Examples:');
  });
});

describe('set and unset with rules between variables', () => {
  const useRules = () =>
    writeFile(path('env.schema.json'), JSON.stringify(RULES_SCHEMA));
  const env = (content: string) => writeFile(path('.env'), content);

  it('refuses a set that would break a rule, writing nothing', async () => {
    await useRules();
    await env('SM_MASTER_KEY_FILE=/run/key\n');
    const r = await cli(['set', '--file', '.env', `SM_MASTER_KEY=${KEY_A}`]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: SM_MASTER_KEY, SM_MASTER_KEY_FILE: set only one of them',
      'nothing was written to .env',
    ]);
    expect(await read('.env')).toBe('SM_MASTER_KEY_FILE=/run/key\n');
    expect([...r.out, ...r.err].join('\n')).not.toContain(KEY_A);
  });

  it('refuses a previous key equal to the current one', async () => {
    await useRules();
    await env(`SM_MASTER_KEY=${KEY_A}\n`);
    const r = await cli([
      'set',
      '--file',
      '.env',
      `SM_PREVIOUS_MASTER_KEY=${KEY_A}`,
    ]);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      'configure-env: SM_PREVIOUS_MASTER_KEY: must differ from SM_MASTER_KEY',
    );
    const ok = await cli([
      'set',
      '--file',
      '.env',
      `SM_PREVIOUS_MASTER_KEY=${KEY_B}`,
    ]);
    expect(ok.code).toBe(0);
  });

  it('refuses --generate while the conflicting partner is set', async () => {
    await useRules();
    await env('SM_MASTER_KEY_FILE=/run/key\n');
    const r = await cli([
      'set',
      '--file',
      '.env',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(r).toMatchObject({
      code: 2,
      out: [],
      err: [
        'configure-env: SM_MASTER_KEY: --generate would set it while SM_MASTER_KEY_FILE is set; set only one of them',
      ],
    });
    // Nothing is generated, so no base64 value of 32 bytes reaches the output.
    expect([...r.out, ...r.err].join('\n')).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    expect(await read('.env')).toBe('SM_MASTER_KEY_FILE=/run/key\n');
    await env('');
    const given = await cli([
      'set',
      '--file',
      '.env',
      'SM_MASTER_KEY_FILE=/run/key',
      '--generate',
      'SM_MASTER_KEY',
    ]);
    expect(given.code).toBe(2);
    expect(await read('.env')).toBe('');
  });

  it('lets an unrelated set through, and swaps a pair in one set', async () => {
    await useRules();
    await env('SM_MASTER_KEY_FILE=/run/key\n');
    expect(
      (await cli(['set', '--file', '.env', 'SM_PREVIOUS_MASTER_KEY_FILE=/old']))
        .code,
    ).toBe(0);
    const swap = await cli([
      'set',
      '--file',
      '.env',
      'SM_MASTER_KEY_FILE=',
      `SM_MASTER_KEY=${KEY_A}`,
    ]);
    expect(swap.code).toBe(0);
  });

  it('unset may leave a requiredUnless key unsatisfied, for validate to report', async () => {
    await useRules();
    await env('SM_MASTER_KEY_FILE=/run/key\n');
    const r = await cli(['unset', '--file', '.env', 'SM_MASTER_KEY_FILE']);
    expect(r).toMatchObject({ code: 0, out: ['SM_MASTER_KEY_FILE: removed'] });
    const v = await cli(['validate', '--file', '.env']);
    expect(v.code).toBe(1);
    expect(v.out).toContain(
      '.env: SM_MASTER_KEY: required unless SM_MASTER_KEY_FILE is set',
    );
  });

  it('appends a requiredUnless key with its generated comment line, and unset removes it', async () => {
    await useRules();
    await env('SM_MASTER_KEY_FILE=\n');
    await cli(['set', '--file', '.env', `SM_MASTER_KEY=${KEY_A}`]);
    expect(await read('.env')).toBe(
      `SM_MASTER_KEY_FILE=\n\n# required unless SM_MASTER_KEY_FILE is set\nSM_MASTER_KEY=${KEY_A}\n`,
    );
    await cli(['unset', '--file', '.env', 'SM_MASTER_KEY']);
    expect(await read('.env')).toBe('SM_MASTER_KEY_FILE=\n');
  });
});
