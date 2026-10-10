import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan } from './apply.ts';
import { checkDrift } from './check.ts';
import { planChanges } from './plan.ts';
import { GENERATED, MERGED, testSchema, useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const root = () => temp.dirs.root;

const check = () => checkDrift({ schema: testSchema(), root: root() });
const summary = async () =>
  (await check()).files.map((f) => [f.path, f.status, f.drift]);

describe('checkDrift', () => {
  it('reports missing generate and merge files; a create-only one never drifts', async () => {
    const report = await check();
    expect(report).toMatchObject({ drift: true, ok: false });
    expect(await summary()).toEqual([
      ['gen/app.env', 'missing', true],
      ['merge.env', 'missing', true],
      ['local.env', 'missing', false],
    ]);
  });

  it('passes once the files are applied', async () => {
    await applyPlan(
      await planChanges({
        schema: testSchema(),
        root: root(),
        values: { TOKEN: 'abcdefgh' },
      }),
    );
    const report = await check();
    expect(report).toMatchObject({ drift: false, ok: true, errors: [] });
    expect(await summary()).toEqual([
      ['gen/app.env', 'current', false],
      ['merge.env', 'current', false],
      ['local.env', 'current', false],
    ]);
  });

  it('reports a generate file whose content differs', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), `${GENERATED}EXTRA=1\n`);
    expect((await check()).files[0]).toMatchObject({
      status: 'differs',
      drift: true,
    });
  });

  it('reports the keys a merge file lacks', async () => {
    await writeFile(join(root(), 'merge.env'), 'CUSTOM=1\nHOST=web\n');
    expect((await check()).files[1]).toMatchObject({
      status: 'missing-keys',
      drift: true,
      missingKeys: ['PORT', 'DEBUG'],
    });
  });

  it('never reports drift for an existing create-only file', async () => {
    await writeFile(join(root(), 'local.env'), 'HOST=web\nOTHER=1\n', {
      mode: 0o600,
    });
    expect((await check()).files[2]).toMatchObject({
      status: 'current',
      drift: false,
      invalid: [],
    });
  });

  it('reports invalid and missing required values, never the value', async () => {
    await writeFile(
      join(root(), 'merge.env'),
      `${MERGED.replace('PORT=8080', 'PORT=http')}`,
    );
    await writeFile(join(root(), 'local.env'), 'TOKEN="hunter2"\n');
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[1]).toMatchObject({
      drift: false,
      invalid: [{ key: 'PORT', message: expect.stringMatching(/port/) }],
    });
    expect(report.files[2]!.invalid).toMatchObject([
      { key: 'HOST', message: 'is required' },
      { key: 'TOKEN', message: expect.stringMatching(/8/) },
    ]);
    expect(JSON.stringify(report)).not.toContain('hunter2');
  });

  it('does not type-check a value the file sets as a placeholder', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), GENERATED);
    expect((await check()).files[0]).toMatchObject({
      status: 'current',
      invalid: [],
    });
  });

  it('checks only the requested files', async () => {
    const report = await checkDrift({
      schema: testSchema(),
      root: root(),
      files: ['merge.env'],
    });
    expect(report.files.map((f) => f.path)).toEqual(['merge.env']);
  });

  it('reports a mode that differs from the schema as drift', async () => {
    await applyPlan(
      await planChanges({
        schema: testSchema(),
        root: root(),
        values: { TOKEN: 'abcdefgh' },
      }),
    );
    await chmod(join(root(), 'local.env'), 0o644);
    const report = await check();
    expect(report).toMatchObject({ drift: true, ok: false });
    expect(report.files[2]).toMatchObject({
      status: 'current',
      drift: true,
      mode: { actual: '644', expected: '600' },
    });
    // A file without a schema mode never drifts on its mode.
    expect(report.files[0]).toMatchObject({ drift: false });
    expect(report.files[0]!.mode).toBeUndefined();
  });

  it('plans a mode-only update for a generate file, so apply fixes it', async () => {
    const schema = testSchema();
    schema.files[0]!.mode = '600';
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), GENERATED, { mode: 0o644 });
    await chmod(join(root(), 'gen/app.env'), 0o644);
    const p = await planChanges({
      schema,
      root: root(),
      values: {},
      files: ['gen/app.env'],
    });
    expect(p.files[0]).toMatchObject({
      action: 'update',
      addedKeys: [],
      currentMode: 0o644,
      mode: 0o600,
    });
    await applyPlan(p);
    const report = await checkDrift({
      schema,
      root: root(),
      files: ['gen/app.env'],
    });
    expect(report.files[0]).toMatchObject({ status: 'current', drift: false });
  });

  it('reports lines that are not valid entries', async () => {
    await writeFile(join(root(), 'merge.env'), `HOST="open\n${MERGED}`);
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[1]).toMatchObject({
      status: 'current',
      invalidLines: [1],
    });
  });

  it('shows an invalid value masked when the variable is secret', async () => {
    await writeFile(join(root(), 'local.env'), 'HOST=web\nTOKEN=hunter2\n');
    const report = await check();
    expect(report.files[2]!.invalid).toEqual([
      { key: 'TOKEN', message: expect.any(String), shown: '•••••••' },
    ]);
    await writeFile(join(root(), 'merge.env'), MERGED.replace('8080', 'http'));
    expect((await check()).files[1]!.invalid).toEqual([
      { key: 'PORT', message: expect.any(String), shown: 'http' },
    ]);
  });
});
