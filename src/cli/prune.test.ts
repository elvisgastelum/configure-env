// apply --prune and check --strict: a variable removed from the schema
// leaves the env files with its comment, and only when asked.

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const TOKEN = 'token-value-123456';

/** Commented variables, a protected secret, a template and a generate file. */
const PRUNE_SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 3000, comment: 'HTTP port' },
    API_TOKEN: {
      type: 'string',
      secret: true,
      protected: true,
      comment: 'tok',
    },
    DEBUG: { type: 'boolean', default: false, comment: 'Debug output' },
    LEVEL: { type: 'string', default: 'info' },
  },
  files: [
    { path: '.env.example', policy: 'merge', variables: '*' },
    { path: '.env', policy: 'create-only', variables: '*' },
    { path: 'gen.env', policy: 'generate', variables: ['PORT'] },
  ],
};

type Schema = typeof PRUNE_SCHEMA;

const dirs = useProject(PRUNE_SCHEMA);
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const path = (name: string) => join(dirs.root, name);
const read = (name: string) => readFile(path(name), 'utf8');
const useSchema = (schema: unknown) =>
  writeFile(path('env.schema.json'), JSON.stringify(schema));
const STATE = '.configure-env/state.json';
const fingerprints = async () =>
  (JSON.parse(await read(STATE)) as { fingerprints: Record<string, object> })
    .fingerprints;

/** The schema without `keys`, each file listing only the rest. */
const without = (...keys: string[]): Schema => ({
  ...PRUNE_SCHEMA,
  variables: Object.fromEntries(
    Object.entries(PRUNE_SCHEMA.variables).filter(
      ([key]) => !keys.includes(key),
    ),
  ) as Schema['variables'],
});

/** What a fresh apply of `schema` writes to `file`. */
async function fresh(schema: unknown, file: string) {
  await rm(path(file));
  await useSchema(schema);
  await cli(['apply', '--ci', '--file', file]);
  return read(file);
}

const json = (r: { out: string[] }) => JSON.parse(r.out.join(''));

describe('apply --prune', () => {
  it('removes a key the schema dropped, with its comment and blank line', async () => {
    await cli(['apply', '--ci', '--set', `API_TOKEN=${TOKEN}`]);
    await useSchema(without('DEBUG'));
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r).toMatchObject({
      code: 0,
      err: [],
      out: [
        '.env.example: pruned keys: DEBUG',
        '.env: pruned keys: DEBUG',
        'gen.env: unchanged',
      ],
    });
    const example = await read('.env.example');
    expect(example).toBe(
      '# HTTP port\nPORT=3000\n\n# tok\n# protected\nAPI_TOKEN=\nLEVEL=info\n',
    );
    expect(await read('.env')).toBe(
      `# HTTP port\nPORT=3000\n\n# tok\n# protected\nAPI_TOKEN=${TOKEN}\nLEVEL=info\n`,
    );
    expect(await fresh(without('DEBUG'), '.env.example')).toBe(example);
    expect(r.out.join('\n')).not.toContain(TOKEN);
  });

  it('removes a key without a comment, and one added by hand', async () => {
    await cli(['apply', '--ci']);
    await writeFile(
      path('.env.example'),
      `${await read('.env.example')}\n# notes\n\nCUSTOM=1\n`,
    );
    await useSchema(without('LEVEL'));
    const r = await cli(['apply', '--ci', '--prune', '--file', '.env.example']);
    expect(r.out).toEqual(['.env.example: pruned keys: LEVEL, CUSTOM']);
    // A comment set apart from the key by a blank line stays.
    expect(await read('.env.example')).toBe(
      '# HTTP port\nPORT=3000\n\n# tok\n# protected\nAPI_TOKEN=\n\n# Debug output\nDEBUG=false\n\n# notes\n',
    );
  });

  it('adds and prunes in one run, and is idempotent', async () => {
    await cli(['apply', '--ci']);
    const schema = without('DEBUG');
    schema.variables = {
      ...schema.variables,
      NEW: { type: 'string', default: 'x' },
    } as Schema['variables'];
    await useSchema(schema);
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r.out).toEqual([
      '.env.example: added keys: NEW; pruned keys: DEBUG',
      '.env: pruned keys: DEBUG',
      'gen.env: unchanged',
    ]);
    const again = await cli(['apply', '--ci', '--prune']);
    expect(again).toMatchObject({
      code: 0,
      out: [
        '.env.example: unchanged',
        '.env: skipped (exists)',
        'gen.env: unchanged',
      ],
    });
  });

  it('prints prunedKeys per file with --json', async () => {
    await cli(['apply', '--ci']);
    await useSchema(without('DEBUG', 'LEVEL'));
    const r = await cli(['apply', '--ci', '--json', '--prune']);
    expect(r.code).toBe(0);
    expect(json(r)).toEqual({
      command: 'apply',
      ok: true,
      errors: [],
      files: [
        {
          path: '.env.example',
          policy: 'merge',
          action: 'update',
          status: 'pruned keys: DEBUG, LEVEL',
          addedKeys: [],
          prunedKeys: ['DEBUG', 'LEVEL'],
          written: true,
        },
        {
          path: '.env',
          policy: 'create-only',
          action: 'update',
          status: 'pruned keys: DEBUG, LEVEL',
          addedKeys: [],
          prunedKeys: ['DEBUG', 'LEVEL'],
          written: true,
        },
        {
          path: 'gen.env',
          policy: 'generate',
          action: 'unchanged',
          status: 'unchanged',
          addedKeys: [],
          prunedKeys: [],
          written: false,
        },
      ],
      deferred: [],
    });
  });

  it('keeps every key without --prune', async () => {
    await cli(['apply', '--ci']);
    const before = await read('.env.example');
    await useSchema(without('DEBUG'));
    const r = await cli(['apply', '--ci']);
    expect(r.out).toEqual([
      '.env.example: unchanged',
      '.env: skipped (exists)',
      'gen.env: unchanged',
    ]);
    expect(await read('.env.example')).toBe(before);
  });

  it('leaves a generate file to its rewrite', async () => {
    await cli(['apply', '--ci']);
    const before = await stat(path('gen.env'));
    await useSchema(without('DEBUG'));
    await cli(['apply', '--ci', '--prune']);
    expect((await stat(path('gen.env'))).ino).toBe(before.ino);
    expect(await read('gen.env')).toBe('# HTTP port\nPORT=3000\n');
  });

  it("removes a pruned key's protected fingerprint", async () => {
    await cli(['apply', '--ci', '--set', `API_TOKEN=${TOKEN}`]);
    expect(Object.keys(await fingerprints())).toEqual(['.env']);
    await useSchema(without('API_TOKEN'));
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(r.out).toContain('.env: pruned keys: API_TOKEN');
    expect(await read('.env')).toBe(
      '# HTTP port\nPORT=3000\n\n# Debug output\nDEBUG=false\nLEVEL=info\n',
    );
    expect(await fingerprints()).toEqual({});
    expect([...r.out, ...r.err].join('\n')).not.toContain(TOKEN);
  });

  it('lists the keys to prune in the terminal plan', async () => {
    await cli(['apply', '--ci']);
    await useSchema(without('DEBUG'));
    const { prompts, logs } = scriptedPrompts();
    const r = await cli(['apply', '--prune'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    const plan = logs.find((line) => line.startsWith('note: Plan'))!;
    expect(plan).toContain('.env.example: prune keys: DEBUG');
    expect(plan).toContain('.env: prune keys: DEBUG');
    expect(await read('.env.example')).not.toContain('DEBUG');
  });
});

describe('check --strict', () => {
  it('reports the keys apply --prune removes as drift', async () => {
    await cli(['apply', '--ci']);
    await useSchema(without('DEBUG'));
    expect((await cli(['check', '--ci'])).code).toBe(0);
    const r = await cli(['check', '--ci', '--strict']);
    expect(r).toMatchObject({
      code: 1,
      out: [
        '.env.example: current',
        '.env.example: unknown keys: DEBUG (run configure-env apply --prune to remove them)',
        '.env: current',
        '.env: unknown keys: DEBUG (run configure-env apply --prune to remove them)',
        'gen.env: current',
      ],
    });
    const report = json(await cli(['check', '--ci', '--json', '--strict']));
    expect(report).toMatchObject({ ok: false, drift: true });
    expect(
      report.files.map((file: { unknownKeys: string[] }) => file.unknownKeys),
    ).toEqual([['DEBUG'], ['DEBUG'], []]);

    await cli(['apply', '--ci', '--prune']);
    expect(await cli(['check', '--ci', '--strict'])).toMatchObject({
      code: 0,
      out: ['.env.example: current', '.env: current', 'gen.env: current'],
    });
  });
});
