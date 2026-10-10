// set, get and unset: single-variable edits that keep every other byte.

import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliError } from './common.ts';
import { readStream } from './stdin.ts';
import {
  CLI_SCHEMA,
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
      (await cli(['set', '--generate', 'EXTRA', '--allow-unknown'])).code,
    ).toBe(2);
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
    expect(await read('app.env')).toBe('PORT=1\n\nMODE=dev\n');
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
    expect(await read('app.env')).toBe('# The port.\n\n');
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
