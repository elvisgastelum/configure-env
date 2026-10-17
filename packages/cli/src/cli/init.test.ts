import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_ID,
  inferVariables,
  parseSchemaText,
} from '@configure-env/core';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject(null);
const root = () => dirs.root;
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: root(), ...options });
const readSchema = async () =>
  JSON.parse(await readFile(join(root(), 'env.schema.json'), 'utf8'));

const EXAMPLE = [
  '# A header, set apart by a blank line',
  '',
  '# Address to listen on',
  'WEB_HOST=127.0.0.1',
  '# The port',
  '#',
  '# Any free one',
  'WEB_PORT=8080',
  'RATIO=0.5',
  'NEG=-3',
  'DEBUG=true',
  'CONTACT=me@example.com',
  'SITE=https://example.com/path',
  'NAME="hello world"',
  'EMPTY=',
  'WEB_PORT=9999',
  '',
].join('\n');

describe('inferVariables', () => {
  it('infers the type, comment and default of each key', () => {
    expect(inferVariables(EXAMPLE)).toEqual({
      WEB_HOST: {
        type: 'host',
        comment: 'Address to listen on',
        default: '127.0.0.1',
      },
      WEB_PORT: {
        type: 'integer',
        comment: 'The port\n\nAny free one',
        default: 8080,
      },
      RATIO: { type: 'number', default: 0.5 },
      NEG: { type: 'integer', default: -3 },
      DEBUG: { type: 'boolean', default: true },
      CONTACT: { type: 'email', default: 'me@example.com' },
      SITE: { type: 'url', default: 'https://example.com/path' },
      NAME: { type: 'string', default: 'hello world' },
      EMPTY: { type: 'string' },
    });
  });

  it('keeps a value that does not fit its number type as a string', () => {
    expect(
      inferVariables('BIG=123456789012345678901234\nIP=999.1.1.1\n'),
    ).toEqual({
      BIG: { type: 'string', default: '123456789012345678901234' },
      IP: { type: 'string', default: '999.1.1.1' },
    });
  });
});

describe('init', () => {
  it('prints its help', async () => {
    const r = await cli(['init', '--help']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toMatch(/^Usage: configure-env init/);
    expect((await cli(['--help'])).out.join('\n')).toContain('init');
  });

  it('infers a schema from --from, merging into that file', async () => {
    await writeFile(join(root(), 'example.env'), EXAMPLE);
    const r = await cli(['init', '--ci', '--from', 'example.env']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toEqual([
      'Wrote env.schema.json: 9 variables from example.env',
      'Created .gitignore with .configure-env/',
    ]);
    const text = await readFile(join(root(), 'env.schema.json'), 'utf8');
    expect(parseSchemaText(text).ok).toBe(true);
    const schema = JSON.parse(text);
    expect(Object.keys(schema)).toEqual([
      '$schema',
      'version',
      'variables',
      'files',
    ]);
    expect(schema).toMatchObject({
      $schema: SCHEMA_ID,
      version: 1,
      files: [{ path: 'example.env', policy: 'merge', variables: '*' }],
    });
    expect(schema.variables.WEB_PORT).toEqual({
      type: 'integer',
      comment: 'The port\n\nAny free one',
      default: 8080,
    });
    // The source already holds every key, and every value passes.
    expect((await cli(['apply', '--ci'])).out).toEqual([
      'example.env: unchanged',
    ]);
    expect((await cli(['check'])).code).toBe(0);
  });

  it('writes a minimal schema when there is no example file', async () => {
    const r = await cli(['init', '--ci']);
    expect(r.code).toBe(0);
    expect(await readSchema()).toEqual({
      $schema: SCHEMA_ID,
      version: 1,
      variables: {},
      files: [],
    });
    expect((await cli(['check', '--ci'])).code).toBe(0);
  });

  it('refuses to overwrite a schema unless --force', async () => {
    await cli(['init', '--ci']);
    await writeFile(join(root(), 'example.env'), 'A=1\n');
    const refused = await cli(['init', '--ci', '--from', 'example.env']);
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('--force');
    expect((await readSchema()).variables).toEqual({});
    const forced = await cli([
      'init',
      '--ci',
      '--force',
      '--from',
      'example.env',
    ]);
    expect(forced.code).toBe(0);
    expect((await readSchema()).variables).toEqual({
      A: { type: 'integer', default: 1 },
    });
  });

  it('writes the schema to --schema', async () => {
    const r = await cli(['init', '--ci', '--schema', 'config.schema.json']);
    expect(r.code).toBe(0);
    expect((await readdir(root())).sort()).toEqual([
      '.configure-env',
      '.gitignore',
      'config.schema.json',
    ]);
  });

  it('adds .configure-env/ to .gitignore once, keeping its lines', async () => {
    const gitignore = join(root(), '.gitignore');
    await writeFile(gitignore, 'node_modules/\n.env');
    const r = await cli(['init', '--ci']);
    expect(r.out[1]).toBe('Added .configure-env/ to .gitignore');
    expect(await readFile(gitignore, 'utf8')).toBe(
      'node_modules/\n.env\n.configure-env/\n',
    );
    const again = await cli(['init', '--ci', '--force']);
    expect(again.out).toHaveLength(1);
    expect(await readFile(gitignore, 'utf8')).toBe(
      'node_modules/\n.env\n.configure-env/\n',
    );
    // A schema that is not written leaves .gitignore alone.
    await writeFile(gitignore, 'node_modules/\n');
    expect((await cli(['init', '--ci'])).code).toBe(2);
    expect(await readFile(gitignore, 'utf8')).toBe('node_modules/\n');
  });

  it('never writes through a symlinked .gitignore, and says so', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'configure-env-outside-'));
    try {
      await writeFile(join(outside, 'ignore'), 'node_modules/\n');
      await symlink(join(outside, 'ignore'), join(root(), '.gitignore'));
      const r = await cli(['init', '--ci']);
      expect(r.code).toBe(0);
      expect(r.out).toEqual(['Wrote env.schema.json: 0 variables']);
      expect(r.err).toEqual([
        'configure-env: warning: .gitignore is a symlink; add .configure-env/ to it yourself',
      ]);
      expect(await readFile(join(outside, 'ignore'), 'utf8')).toBe(
        'node_modules/\n',
      );
      const json = await cli(['init', '--json', '--force']);
      expect(JSON.parse(json.out[0]!)).toMatchObject({ gitignore: 'symlink' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('exits 2 for a --from that is missing or outside the root', async () => {
    expect((await cli(['init', '--ci', '--from', 'nope.env'])).code).toBe(2);
    const outside = await cli(['init', '--ci', '--from', '../x.env']);
    expect(outside.code).toBe(2);
    expect(outside.err.join('\n')).toContain('inside the root');
    expect(await readdir(root())).toEqual([]);
  });

  it('prints one JSON document with --json', async () => {
    await writeFile(join(root(), 'example.env'), 'A=1\nB=x\n');
    const r = await cli(['init', '--json', '--from', 'example.env']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out[0]!)).toEqual({
      command: 'init',
      ok: true,
      schema: join(root(), 'env.schema.json'),
      from: 'example.env',
      variables: ['A', 'B'],
      gitignore: 'created',
    });
  });

  it('exits 2 without a terminal or --ci', async () => {
    expect((await cli(['init'])).code).toBe(2);
  });

  describe('in the terminal', () => {
    it('writes the inferred types once confirmed', async () => {
      await writeFile(join(root(), 'example.env'), 'PORT=8080\n');
      const { prompts, calls, logs } = scriptedPrompts();
      const r = await cli(['init', '--from', 'example.env'], {
        isTTY: true,
        prompts,
      });
      expect(r.code).toBe(0);
      expect(calls.map((c) => [c.kind, c.message])).toEqual([
        ['confirm', 'Use these types?'],
      ]);
      expect(logs).toContain(
        'note: Inferred from example.env: PORT: integer (8080)',
      );
      expect((await readSchema()).variables.PORT.type).toBe('integer');
    });

    it('lets each type be changed, dropping a default that no longer fits', async () => {
      await writeFile(join(root(), 'example.env'), 'PORT=8080\nNAME=web\n');
      const { prompts, calls } = scriptedPrompts({
        'Use these types?': false,
        PORT: 'port',
        NAME: 'integer',
      });
      const r = await cli(['init', '--from', 'example.env'], {
        isTTY: true,
        prompts,
      });
      expect(r.code).toBe(0);
      expect(calls.filter((c) => c.kind === 'select')).toHaveLength(2);
      expect((await readSchema()).variables).toEqual({
        PORT: { type: 'port', default: 8080 },
        NAME: { type: 'integer' },
      });
    });

    it('exits 130 on cancel and writes nothing', async () => {
      await writeFile(join(root(), 'example.env'), 'PORT=8080\n');
      const { prompts } = scriptedPrompts({ 'Use these types?': 'cancel' });
      const r = await cli(['init', '--from', 'example.env'], {
        isTTY: true,
        prompts,
      });
      expect(r.code).toBe(130);
      expect(await readdir(root())).toEqual(['example.env']);
    });
  });
});
