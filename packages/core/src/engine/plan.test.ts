import { mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { applyPlan } from './apply.ts';
import { planChanges } from './plan.ts';
import {
  GENERATED,
  MERGED,
  rulesSchema,
  schemaOf,
  testSchema,
  useTempRoot,
} from './test-helpers.ts';

const temp = useTempRoot();
const root = () => temp.dirs.root;

const plan = (options: Partial<Parameters<typeof planChanges>[0]> = {}) =>
  planChanges({ schema: testSchema(), root: root(), values: {}, ...options });

const byPath = async (options?: Parameters<typeof plan>[0]) =>
  Object.fromEntries((await plan(options)).files.map((f) => [f.path, f]));

describe('planChanges on a fresh root', () => {
  it('creates every file and writes nothing', async () => {
    const p = await plan({ values: { TOKEN: 'abcdefgh' } });
    expect(p.errors).toEqual([]);
    expect(p.files.map((f) => [f.path, f.policy, f.action])).toEqual([
      ['gen/app.env', 'generate', 'create'],
      ['merge.env', 'merge', 'create'],
      ['local.env', 'create-only', 'create'],
    ]);
    await expect(stat(join(root(), 'gen'))).rejects.toThrow();
    await expect(stat(join(root(), 'merge.env'))).rejects.toThrow();
  });

  it('generates the header, comments and groups, file values first', async () => {
    const files = await byPath({ values: { TOKEN: 'abcdefgh', PORT: '9000' } });
    expect(files['gen/app.env']).toMatchObject({
      action: 'create',
      mode: 0o644,
      addedKeys: ['HOST', 'PORT', 'TOKEN', 'DEBUG'],
    });
    // The file's TOKEN value wins over the given one; PORT takes the given.
    expect(files['gen/app.env']!.content).toBe(
      GENERATED.replace('PORT=8080', 'PORT=9000'),
    );
  });

  it('creates a merge file as generate would, with comment overrides', async () => {
    const files = await byPath();
    expect(files['merge.env']!.content).toBe(MERGED);
  });

  it('creates a create-only file from the values, with its mode', async () => {
    const files = await byPath({ values: { TOKEN: 'pa$$word' } });
    expect(files['local.env']).toMatchObject({ action: 'create', mode: 0o600 });
    expect(files['local.env']!.content).toBe(
      [
        '# Where to listen.',
        'HOST=127.0.0.1',
        '',
        '# API token.',
        '#',
        '# Keep it safe.',
        "TOKEN='pa$$word'",
        '',
      ].join('\n'),
    );
  });

  it('writes typed values in their canonical form', async () => {
    const files = await byPath({ values: { DEBUG: 'yes', HOST: 'web.lan' } });
    expect(files['merge.env']!.content).toContain('\nDEBUG=true\n');
    expect(files['merge.env']!.content).toContain('HOST=web.lan\n');
  });
});

describe('planChanges on existing files', () => {
  it('is idempotent: a second plan after applying changes nothing', async () => {
    await applyPlan(await plan({ values: { TOKEN: 'abcdefgh' } }));
    const again = await plan({ values: { TOKEN: 'abcdefgh' } });
    expect(again.files.map((f) => [f.path, f.action, f.reason])).toEqual([
      ['gen/app.env', 'unchanged', undefined],
      ['merge.env', 'unchanged', undefined],
      ['local.env', 'skip', 'exists'],
    ]);
  });

  it('rewrites a generate file that differs', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), 'EDITED=1\n');
    const files = await byPath();
    expect(files['gen/app.env']).toMatchObject({
      action: 'update',
      previous: 'EDITED=1\n',
      content: GENERATED,
    });
  });

  it('merges only the missing keys, keeping every existing byte', async () => {
    const existing = '# mine\r\nCUSTOM= kept  # note\r\nHOST=10.0.0.5';
    await writeFile(join(root(), 'merge.env'), existing);
    const files = await byPath({ values: { PORT: '9000', HOST: 'other' } });
    expect(files['merge.env']).toMatchObject({
      action: 'update',
      addedKeys: ['PORT', 'DEBUG'],
      previous: existing,
    });
    expect(files['merge.env']!.content).toBe(
      `${existing}\r\n\r\n# The port.\r\nPORT=9000\r\n\r\nDEBUG=false\r\n`,
    );
  });

  it('adds no blank line to an empty merge file', async () => {
    await writeFile(join(root(), 'merge.env'), '');
    expect((await byPath())['merge.env']!.content).toBe(MERGED);
  });

  it('is idempotent after a merge', async () => {
    await writeFile(join(root(), 'merge.env'), '# mine\nCUSTOM=1\nHOST=web');
    await applyPlan(await plan({ files: ['merge.env'] }));
    const again = await plan({ files: ['merge.env'] });
    expect(again.files[0]).toMatchObject({
      action: 'unchanged',
      addedKeys: [],
    });
  });

  it('leaves a merge file with every key unchanged, whatever its values', async () => {
    await writeFile(join(root(), 'merge.env'), 'DEBUG=maybe\nPORT=1\nHOST=x\n');
    expect((await byPath())['merge.env']).toMatchObject({
      action: 'unchanged',
      addedKeys: [],
    });
  });

  it('skips an existing create-only file', async () => {
    await writeFile(join(root(), 'local.env'), 'KEEP=1\n', { mode: 0o600 });
    expect((await byPath())['local.env']).toMatchObject({
      action: 'skip',
      reason: 'exists',
      previous: 'KEEP=1\n',
    });
  });

  it('keeps the mode of an existing file unless the schema sets one', async () => {
    await writeFile(join(root(), 'merge.env'), 'A=1\n', { mode: 0o640 });
    expect((await byPath())['merge.env']!.mode).toBe(0o640);
  });

  it('plans only the requested files, in schema order', async () => {
    const p = await plan({ files: ['local.env', 'merge.env'] });
    expect(p.files.map((f) => f.path)).toEqual(['merge.env', 'local.env']);
    const unknown = await plan({ files: ['nope.env'] });
    expect(unknown.errors).toEqual([
      { kind: 'file', path: 'nope.env', message: 'is not in the schema' },
    ]);
  });
});

describe('planChanges values', () => {
  it('reports invalid values with typed errors, never the value', async () => {
    const p = await plan({
      values: { TOKEN: 'hunter2', PORT: '70000', NOPE: 'x' },
    });
    expect(p.errors).toEqual([
      { kind: 'value', key: 'TOKEN', message: expect.stringMatching(/8/) },
      { kind: 'value', key: 'PORT', message: expect.stringMatching(/port/) },
      {
        kind: 'value',
        key: 'NOPE',
        message: 'is not declared in the schema',
      },
    ]);
    expect(JSON.stringify(p)).not.toContain('hunter2');
  });
});

describe('planChanges path safety', () => {
  const withPath = (path: string) => {
    const schema = testSchema();
    schema.files[1]!.path = path;
    return planChanges({ schema, root: root(), values: {} });
  };

  it('refuses a path that escapes the root', async () => {
    const p = await withPath('../escape.env');
    expect(p.files[1]).toMatchObject({ action: 'skip', reason: 'refused' });
    expect(p.errors).toEqual([
      {
        kind: 'file',
        path: '../escape.env',
        message: expect.stringMatching(/outside the root/),
      },
    ]);
  });

  it('refuses a path through a symlinked directory outside the root', async () => {
    const outside = await temp.another();
    await symlink(outside, join(root(), 'link'));
    const p = await withPath('link/../../escape.env');
    expect(p.files[1]).toMatchObject({ action: 'skip', reason: 'refused' });
    const q = await withPath('link/sub/app.env');
    expect(q.errors).toEqual([
      {
        kind: 'file',
        path: 'link/sub/app.env',
        message: expect.stringMatching(/outside the root/),
      },
    ]);
  });

  it('allows a symlinked directory inside the root', async () => {
    await mkdir(join(root(), 'real'));
    await symlink(join(root(), 'real'), join(root(), 'alias'));
    const p = await withPath('alias/app.env');
    expect(p.errors).toEqual([]);
    expect(p.files[1]!.action).toBe('create');
  });

  it('refuses to write through an existing symlink', async () => {
    await writeFile(join(root(), 'target.txt'), 'A=1\n');
    await symlink(join(root(), 'target.txt'), join(root(), 'linked.env'));
    const p = await withPath('linked.env');
    expect(p.errors).toEqual([
      {
        kind: 'file',
        path: 'linked.env',
        message: expect.stringMatching(/symlink/),
      },
    ]);
  });

  it('refuses a path that is a directory', async () => {
    await mkdir(join(root(), 'dir.env'));
    const p = await withPath('dir.env');
    expect(p.errors[0]).toMatchObject({ message: 'is not a regular file' });
  });
});

describe('planChanges file comments', () => {
  it('uses the per-file comment over the variable comment', async () => {
    const schema = schemaOf({
      variables: { A: { type: 'string', comment: 'Default.' } },
      files: [
        { path: 'one.env', policy: 'generate', variables: '*' },
        {
          path: 'two.env',
          policy: 'generate',
          variables: '*',
          comments: { A: 'Override\nspans lines.' },
        },
      ],
    });
    const p = await planChanges({ schema, root: root(), values: {} });
    expect(p.files.map((f) => f.content)).toEqual([
      '# Default.\nA=\n',
      '# Override\n# spans lines.\nA=\n',
    ]);
  });
});

describe('planChanges requiredUnless comments', () => {
  it('adds a line after the comment, naming the alternatives the file lists', async () => {
    const p = await planChanges({
      schema: rulesSchema(),
      root: root(),
      values: {},
    });
    expect(p.files[0]!.content).toBe(
      [
        '# The master key.',
        '# required unless KEY_FILE is set',
        'KEY=',
        'KEY_FILE=',
        '',
        '# required unless OLD_KEY_FILE or KEY_FILE is set',
        'OLD_KEY=',
        'OLD_KEY_FILE=',
        '',
      ].join('\n'),
    );
    expect(p.files[2]!.content).toBe(
      ['# The master key.', 'KEY=', 'OLD_KEY=', ''].join('\n'),
    );
  });

  it('adds it to the keys a merge file appends', async () => {
    await writeFile(join(root(), 'app.env'), 'KEY_FILE=/run/key\n');
    const p = await planChanges({
      schema: rulesSchema(),
      root: root(),
      values: {},
    });
    expect(p.files[0]!.content).toBe(
      [
        'KEY_FILE=/run/key',
        '',
        '# The master key.',
        '# required unless KEY_FILE is set',
        'KEY=',
        '',
        '# required unless OLD_KEY_FILE or KEY_FILE is set',
        'OLD_KEY=',
        'OLD_KEY_FILE=',
        '',
      ].join('\n'),
    );
  });
});
