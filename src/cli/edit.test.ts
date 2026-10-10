// set, get and unset: single-variable edits that keep every other byte.

import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLI_SCHEMA,
  run,
  scriptedPrompts,
  useProject,
} from './test-helpers.ts';

/** One file to edit and its template. */
export const EDIT_SCHEMA = {
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
