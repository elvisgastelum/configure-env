import {
  chmod,
  link,
  mkdir,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan } from './apply.ts';
import { planChanges } from './plan.ts';
import { GENERATED, testSchema, useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const root = () => temp.dirs.root;

const plan = (files?: string[], schema = testSchema()) =>
  planChanges({
    schema,
    root: root(),
    values: { TOKEN: 'abcdefgh' },
    files,
  });

const modeOf = async (path: string) =>
  (await stat(join(root(), path))).mode & 0o777;

describe('applyPlan', () => {
  it('writes the planned files, creating parent directories', async () => {
    const results = await applyPlan(await plan());
    expect(results).toEqual([
      { path: 'gen/app.env', action: 'create', ok: true, written: true },
      { path: 'merge.env', action: 'create', ok: true, written: true },
      { path: 'local.env', action: 'create', ok: true, written: true },
    ]);
    // A fresh plan sees the written content as current.
    const again = await plan(['gen/app.env']);
    expect(again.files[0]).toMatchObject({
      action: 'unchanged',
      previous: GENERATED,
    });
  });

  it('creates with mode 600 when the schema says so, else 644', async () => {
    await applyPlan(await plan());
    expect(await modeOf('local.env')).toBe(0o600);
    expect(await modeOf('gen/app.env')).toBe(0o644);
  });

  it('keeps the mode of an updated file', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), 'OLD=1\n');
    await chmod(join(root(), 'gen/app.env'), 0o640);
    const [result] = await applyPlan(await plan(['gen/app.env']));
    expect(result).toMatchObject({ action: 'update', ok: true });
    expect(await modeOf('gen/app.env')).toBe(0o640);
  });

  it('applies the schema mode to an updated file', async () => {
    const schema = testSchema();
    schema.files[0]!.mode = '600';
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), 'OLD=1\n', { mode: 0o644 });
    await applyPlan(await plan(['gen/app.env'], schema));
    expect(await modeOf('gen/app.env')).toBe(0o600);
  });

  it('writes nothing for unchanged and skipped files', async () => {
    await writeFile(join(root(), 'local.env'), 'KEEP=1\n');
    const [result] = await applyPlan(await plan(['local.env']));
    expect(result).toEqual({
      path: 'local.env',
      action: 'skip',
      ok: true,
      written: false,
    });
  });

  it('leaves no temporary file behind when a write fails', async () => {
    const p = await plan(['gen/app.env']);
    // A directory takes the file's place after planning.
    await mkdir(join(root(), 'gen/app.env/blocker'), { recursive: true });
    const [result] = await applyPlan(p);
    expect(result).toMatchObject({ ok: false, written: false });
    expect(result!.error).toMatch(/EEXIST|exists/);
    expect(await readdir(join(root(), 'gen'))).toEqual(['app.env']);
  });

  it('reports a partial failure per file and writes the rest', async () => {
    const p = await plan(['gen/app.env', 'merge.env']);
    await mkdir(join(root(), 'gen/app.env'), { recursive: true });
    const results = await applyPlan(p);
    expect(results.map((r) => [r.path, r.ok, r.written])).toEqual([
      ['gen/app.env', false, false],
      ['merge.env', true, true],
    ]);
    expect(results[0]!.error).toBeTruthy();
    expect(await readdir(root())).toEqual(['gen', 'merge.env']);
  });

  it('never replaces a file created after planning', async () => {
    const p = await plan(['local.env']);
    await writeFile(join(root(), 'local.env'), 'RACE=1\n');
    const [result] = await applyPlan(p);
    expect(result).toMatchObject({ ok: false, written: false });
    const again = await plan(['local.env']);
    expect(again.files[0]!.previous).toBe('RACE=1\n');
  });

  it('refuses to update a file changed since planning', async () => {
    await writeFile(join(root(), 'merge.env'), 'A=1\n');
    const p = await plan(['merge.env']);
    await writeFile(join(root(), 'merge.env'), 'A=2\n');
    const [result] = await applyPlan(p);
    expect(result).toMatchObject({
      ok: false,
      error: 'changed since it was planned',
    });
    expect((await plan(['merge.env'])).files[0]!.previous).toBe('A=2\n');
  });

  it('writes nothing when the plan has errors', async () => {
    const p = await planChanges({
      schema: testSchema(),
      root: root(),
      values: { PORT: 'nope' },
    });
    const results = await applyPlan(p);
    expect(results.every((r) => !r.ok && !r.written)).toBe(true);
    expect(results[0]!.error).toBe('the plan has errors');
    expect(await readdir(root())).toEqual([]);
  });

  it.each(['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'])(
    'creates the file exclusively when link fails with %s',
    async (code) => {
      const failingLink: typeof link = () =>
        Promise.reject(Object.assign(new Error(code), { code }));
      const [result] = await applyPlan(await plan(['local.env']), {
        link: failingLink,
      });
      expect(result).toMatchObject({ ok: true, written: true });
      expect(await modeOf('local.env')).toBe(0o600);
      expect((await plan(['local.env'])).files[0]).toMatchObject({
        action: 'skip',
        reason: 'exists',
      });
      expect(await readdir(root())).toEqual(['local.env']);
    },
  );

  it('keeps the no-replace guarantee in the link fallback', async () => {
    const p = await plan(['local.env']);
    await writeFile(join(root(), 'local.env'), 'RACE=1\n');
    const failingLink: typeof link = () =>
      Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    const [result] = await applyPlan(p, { link: failingLink });
    expect(result).toMatchObject({ ok: false, written: false });
    expect((await plan(['local.env'])).files[0]!.previous).toBe('RACE=1\n');
    expect(await readdir(root())).toEqual(['local.env']);
  });

  it('does not fall back for other link errors', async () => {
    const failingLink: typeof link = () =>
      Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' }));
    const [result] = await applyPlan(await plan(['local.env']), {
      link: failingLink,
    });
    expect(result).toMatchObject({ ok: false, error: 'EIO' });
    expect(await readdir(root())).toEqual([]);
  });

  it('checks containment before creating parent directories', async () => {
    const schema = testSchema();
    schema.files[0]!.path = 'link/deep/app.env';
    const p = await plan(['link/deep/app.env'], schema);
    // A symlink out of the root appears after planning.
    const outside = await temp.another();
    await symlink(outside, join(root(), 'link'));
    const [result] = await applyPlan(p);
    expect(result).toMatchObject({
      ok: false,
      error: 'resolves outside the root',
    });
    expect(await readdir(outside)).toEqual([]);
  });
});
