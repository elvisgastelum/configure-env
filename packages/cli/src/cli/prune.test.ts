// apply --prune and check --strict: a variable removed from the schema
// leaves the env files with its comment, and only when asked.

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  STATE,
  holdState,
  readState,
  run,
  scriptedPrompts,
  useProject,
} from './test-helpers.ts';

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
const fingerprints = async () => (await readState(path(STATE))).fingerprints;

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

describe('apply --prune and an unusable state', () => {
  const KEPT = 'fingerprints of pruned keys were kept';
  const UNREAD = `${STATE}: cannot be read (is not a valid state database); fingerprints of pruned keys, if any, were kept`;
  const CORRUPT = 'not a SQLite database, but long enough to be read as one';
  const corrupt = async () => {
    await mkdir(path('.configure-env'), { recursive: true });
    await writeFile(path(STATE), CORRUPT);
  };

  it('prunes anyway when the schema protects nothing, with a warning', async () => {
    await cli(['apply', '--ci']);
    await corrupt();
    await useSchema(without('API_TOKEN', 'DEBUG'));
    const warning = UNREAD;
    const r = await cli(['apply', '--ci', '--prune', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: pruned keys: API_TOKEN, DEBUG'],
      err: [`configure-env: warning: ${warning}`],
    });
    expect(await read('.env')).toBe('# HTTP port\nPORT=3000\nLEVEL=info\n');
    const document = json(
      await cli([
        'apply',
        '--ci',
        '--json',
        '--prune',
        '--file',
        '.env.example',
      ]),
    );
    expect(document).toMatchObject({ ok: true, warnings: [warning] });
    expect(await read(STATE)).toBe(CORRUPT);
  });

  it('warns about nothing when the run prunes nothing', async () => {
    await useSchema(without('API_TOKEN'));
    await cli(['apply', '--ci']);
    await corrupt();
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r).toMatchObject({ code: 0, err: [] });
    expect(
      json(await cli(['apply', '--ci', '--json', '--prune'])),
    ).not.toHaveProperty('warnings');
  });

  it('warns in the terminal', async () => {
    await cli(['apply', '--ci']);
    await corrupt();
    await useSchema(without('API_TOKEN', 'DEBUG'));
    const { prompts, logs } = scriptedPrompts();
    const r = await cli(['apply', '--prune'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(logs).toContain(`warn: ${UNREAD}`);
    expect(await read('.env')).toBe('# HTTP port\nPORT=3000\nLEVEL=info\n');
  });

  it('writes the env files when the state write fails, keeping the fingerprint', async () => {
    await cli(['apply', '--ci', '--set', `API_TOKEN=${TOKEN}`]);
    await useSchema(without('API_TOKEN'));
    const r = await cli(['apply', '--ci', '--prune', '--file', '.env'], {
      writeState: async () => {
        throw new Error('disk full');
      },
    });
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: pruned keys: API_TOKEN'],
      err: [
        `configure-env: warning: ${STATE}: not written (disk full); ${KEPT}`,
      ],
    });
    expect(await read('.env')).not.toContain('API_TOKEN');
    expect(Object.keys(await fingerprints())).toEqual(['.env']);
  });

  it('warns about nothing when the pruning file fails to write', async (ctx) => {
    // A name that fits the 255-byte limit while the temporary file beside it
    // does not: the write fails, even as root. A file system with a shorter
    // limit cannot hold the file at all, so the test does not apply there.
    const LONG = `${'a'.repeat(240)}.env`;
    await useSchema({
      version: 1,
      variables: { PORT: { type: 'port', default: 3000 } },
      files: [{ path: LONG, policy: 'merge', variables: ['PORT'] }],
    });
    try {
      await writeFile(path(LONG), 'PORT=1\nOLD=2\n');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENAMETOOLONG') throw error;
      ctx.skip();
    }
    await corrupt();
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r.code).toBe(1);
    // One line, the failure: no warning in stdout or stderr.
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(`${LONG}: failed (ENAMETOOLONG`);
    expect(r.out.join('\n')).not.toMatch(/warn/i);
    expect(r.err).toEqual([]);
    const document = await cli(['apply', '--ci', '--json', '--prune']);
    expect(document.code).toBe(1);
    const report = json(document);
    expect(report.files[0]).toMatchObject({
      path: LONG,
      prunedKeys: ['OLD'],
      written: false,
    });
    expect(report.files[0].status).toMatch(/^failed \(ENAMETOOLONG/);
    expect(report).not.toHaveProperty('warnings');
    expect(await read(LONG)).toBe('PORT=1\nOLD=2\n');
  });

  it('keeps failing when the schema protects a variable', async () => {
    await cli(['apply', '--ci']);
    const before = await read('.env');
    await corrupt();
    await useSchema(without('DEBUG'));
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toContain('invalid state');
    expect(await read('.env')).toBe(before);
  });

  it('creates no state when there is none to forget', async () => {
    await useSchema(without('API_TOKEN'));
    await cli(['apply', '--ci']);
    await useSchema(without('API_TOKEN', 'DEBUG'));
    const r = await cli(['apply', '--ci', '--prune']);
    expect(r).toMatchObject({ code: 0, err: [] });
    await expect(stat(path('.configure-env'))).rejects.toThrow();
    // A run without a warning has no warnings field.
    expect(
      json(await cli(['apply', '--ci', '--json', '--prune'])),
    ).not.toHaveProperty('warnings');
  });

  it('prunes past a state another run holds, keeping the fingerprint', async () => {
    await cli(['apply', '--ci', '--set', `API_TOKEN=${TOKEN}`]);
    onTestFinished(await holdState(path(STATE)));
    await useSchema(without('API_TOKEN'));
    const r = await cli(['apply', '--ci', '--prune', '--file', '.env']);
    expect(r).toMatchObject({
      code: 0,
      out: ['.env: pruned keys: API_TOKEN'],
      err: [
        `configure-env: warning: ${STATE}: not written (in use by another run; try again); ${KEPT}`,
      ],
    });
    expect(await read('.env')).not.toContain('API_TOKEN');
    expect(Object.keys(await fingerprints())).toEqual(['.env']);
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
