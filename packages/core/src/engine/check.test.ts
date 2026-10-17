import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { applyPlan } from './apply.ts';
import { checkDrift } from './check.ts';
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

const check = (strict = false) =>
  checkDrift({ schema: testSchema(), root: root(), strict });
const summary = async () =>
  (await check()).files.map((f) => [f.path, f.status, f.ok]);
/** The problems of the file at `index`, without the optional fields. */
const codes = async (index: number, strict = false) =>
  (await check(strict)).files[index]!.problems.map((p) => [
    p.severity,
    p.code,
    p.key ?? p.line ?? null,
  ]);

const applied = async () =>
  applyPlan(
    await planChanges({
      schema: testSchema(),
      root: root(),
      values: { TOKEN: 'abcdefgh' },
    }),
  );

describe('checkDrift', () => {
  it('reports every missing file as an error, create-only ones too', async () => {
    const report = await check();
    expect(report).toMatchObject({
      command: 'check',
      ok: false,
      summary: { errors: 3, warnings: 0, files: 3, failing: 3 },
      errors: [],
    });
    expect(await summary()).toEqual([
      ['gen/app.env', 'missing', false],
      ['merge.env', 'missing', false],
      ['local.env', 'missing', false],
    ]);
    expect(report.files[2]).toEqual({
      path: 'local.env',
      policy: 'create-only',
      template: false,
      status: 'missing',
      ok: false,
      problems: [
        {
          severity: 'error',
          code: 'missing-file',
          message: 'missing',
          fix: 'apply',
        },
      ],
    });
  });

  it('passes once the files are applied', async () => {
    await applied();
    const report = await check();
    expect(report).toMatchObject({
      ok: true,
      errors: [],
      summary: { errors: 0, warnings: 0, files: 3, failing: 0 },
    });
    expect(await summary()).toEqual([
      ['gen/app.env', 'current', true],
      ['merge.env', 'current', true],
      ['local.env', 'current', true],
    ]);
    expect(report.files.every((file) => !file.problems.length)).toBe(true);
  });

  it('reports a generate file whose content differs', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), `${GENERATED}# note\n`);
    expect((await check()).files[0]).toMatchObject({
      status: 'differs',
      ok: false,
      problems: [
        {
          severity: 'error',
          code: 'differs',
          message: 'differs from the schema',
          fix: 'apply',
        },
      ],
    });
  });

  it('reports each key a merge file lacks, once, never as an invalid value', async () => {
    const schema = testSchema();
    schema.variables.PORT!.required = true;
    await writeFile(join(root(), 'merge.env'), 'HOST=web\n');
    const report = await checkDrift({ schema, root: root() });
    expect(report.files[1]).toMatchObject({ status: 'missing-keys' });
    expect(report.files[1]!.problems).toEqual([
      {
        severity: 'error',
        code: 'missing-key',
        key: 'PORT',
        message: 'is missing',
        fix: 'apply',
      },
      {
        severity: 'error',
        code: 'missing-key',
        key: 'DEBUG',
        message: 'is missing',
        fix: 'apply',
      },
    ]);
  });

  it('reports unknown keys as warnings, errors with strict, for every policy', async () => {
    await applied();
    await writeFile(join(root(), 'merge.env'), `${MERGED}CUSTOM=1\n`);
    await writeFile(join(root(), 'local.env'), 'HOST=web\nOTHER=1\n', {
      mode: 0o600,
    });
    const loose = await check();
    expect(loose).toMatchObject({
      ok: true,
      summary: { errors: 0, warnings: 2, files: 3, failing: 0 },
    });
    expect(loose.files[1]!.problems).toEqual([
      {
        severity: 'warning',
        code: 'unknown-key',
        key: 'CUSTOM',
        message: 'is not in the schema for this file',
        fix: 'prune',
      },
    ]);
    expect(await codes(2)).toEqual([['warning', 'unknown-key', 'OTHER']]);
    const strict = await check(true);
    expect(strict).toMatchObject({
      ok: false,
      summary: { errors: 2, warnings: 0, files: 3, failing: 2 },
    });
    expect(await codes(1, true)).toEqual([['error', 'unknown-key', 'CUSTOM']]);
  });

  it('reports an unknown key of a generate file too', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), `${GENERATED}EXTRA=1\n`);
    expect(await codes(0)).toEqual([
      ['error', 'differs', null],
      ['warning', 'unknown-key', 'EXTRA'],
    ]);
  });

  it('reports invalid and missing required values, never the value', async () => {
    await writeFile(
      join(root(), 'merge.env'),
      `${MERGED.replace('PORT=8080', 'PORT=http')}`,
    );
    await writeFile(join(root(), 'local.env'), 'TOKEN="hunter2"\n');
    await chmod(join(root(), 'local.env'), 0o600);
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[1]!.problems).toEqual([
      {
        severity: 'error',
        code: 'invalid-value',
        key: 'PORT',
        message: expect.stringMatching(/port/),
        shown: 'http',
        fix: 'set',
      },
    ]);
    expect(report.files[2]!.problems).toMatchObject([
      { code: 'invalid-value', key: 'HOST', message: 'is required', shown: '' },
      {
        code: 'invalid-value',
        key: 'TOKEN',
        message: expect.stringMatching(/8/),
      },
    ]);
    for (const problem of report.files.flatMap((file) => file.problems))
      expect(problem.message).not.toContain('http');
    expect(JSON.stringify(report)).not.toContain('hunter2');
  });

  it('does not type-check a value the file sets as a placeholder', async () => {
    await mkdir(join(root(), 'gen'));
    await writeFile(join(root(), 'gen/app.env'), GENERATED);
    expect((await check()).files[0]).toMatchObject({
      status: 'current',
      ok: true,
      problems: [],
    });
  });

  it('checks only the requested files', async () => {
    const report = await checkDrift({
      schema: testSchema(),
      root: root(),
      files: ['merge.env'],
    });
    expect(report.files.map((f) => f.path)).toEqual(['merge.env']);
    expect(report.summary.files).toBe(1);
  });

  it('reports a mode that differs from the schema', async () => {
    await applied();
    await chmod(join(root(), 'local.env'), 0o644);
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[2]).toMatchObject({
      status: 'current',
      ok: false,
      mode: { actual: '644', expected: '600' },
      problems: [
        {
          severity: 'error',
          code: 'mode',
          message: 'mode 644, expected 600',
          fix: 'apply',
        },
      ],
    });
    // A file without a schema mode never drifts on its mode.
    expect(report.files[0]).toMatchObject({ ok: true, problems: [] });
    expect(report.files[0]!.mode).toBeUndefined();
  });

  it('has no fix for a mode apply would have to loosen', async () => {
    await applied();
    await chmod(join(root(), 'local.env'), 0o400);
    const [problem] = (await check()).files[2]!.problems;
    expect(problem).toEqual({
      severity: 'error',
      code: 'mode',
      message: 'mode 400, expected 600',
    });
  });

  it('plans a chmod for a current generate file, so apply fixes it', async () => {
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
      action: 'mode',
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
    expect(report.files[0]).toMatchObject({ status: 'current', ok: true });
  });

  it('reports lines that are not valid entries', async () => {
    await writeFile(join(root(), 'merge.env'), `HOST="open\n${MERGED}`);
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[1]).toMatchObject({ status: 'current', ok: false });
    expect(report.files[1]!.problems).toEqual([
      {
        severity: 'error',
        code: 'invalid-line',
        line: 1,
        message: 'is not a valid entry',
      },
    ]);
  });

  it('reports a refused path, with the plan error', async () => {
    const outside = await temp.another();
    await symlink(join(outside, 'merge.env'), join(root(), 'merge.env'));
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.files[1]).toMatchObject({ status: 'refused', ok: false });
    expect(report.files[1]!.problems).toMatchObject([
      { severity: 'error', code: 'refused', message: expect.any(String) },
    ]);
    expect(report.errors).toMatchObject([{ kind: 'file', path: 'merge.env' }]);
  });

  it('shows an invalid value masked when the variable is secret', async () => {
    await writeFile(join(root(), 'local.env'), 'HOST=web\nTOKEN=hunter2\n');
    await chmod(join(root(), 'local.env'), 0o600);
    const report = await check();
    expect(report.files[2]!.problems).toEqual([
      {
        severity: 'error',
        code: 'invalid-value',
        key: 'TOKEN',
        message: expect.any(String),
        shown: '•••••••',
        fix: 'set',
      },
    ]);
  });

  it('is not ok with a plan error, such as an invalid given value', async () => {
    await applied();
    const report = await checkDrift({
      schema: testSchema(),
      root: root(),
      values: { PORT: 'http' },
    });
    expect(report).toMatchObject({
      ok: false,
      errors: [{ kind: 'value', key: 'PORT' }],
    });
  });
});

describe('checkDrift templates', () => {
  const schema = () =>
    schemaOf({
      variables: {
        PORT: { type: 'port', required: true },
        TOKEN: { type: 'string', secret: true, minLength: 8 },
      },
      files: [
        { path: '.env.example', policy: 'merge', variables: '*' },
        { path: 'app.env.example', policy: 'generate', variables: '*' },
      ],
    });

  it('only check their lines and the presence of each key', async () => {
    await writeFile(join(root(), '.env.example'), 'PORT=\nx\nOTHER=1\n');
    const report = await checkDrift({ schema: schema(), root: root() });
    expect(report.files[0]).toMatchObject({ template: true, ok: false });
    expect(report.files[0]!.problems.map((p) => [p.severity, p.code])).toEqual([
      ['error', 'missing-key'],
      ['error', 'invalid-line'],
      ['warning', 'unknown-key'],
    ]);
    expect(report.files[0]!.problems[0]).toMatchObject({ key: 'TOKEN' });
    // A missing template is an error too.
    expect(report.files[1]!.problems).toMatchObject([{ code: 'missing-file' }]);
  });

  it('report each key a generated template lacks', async () => {
    await writeFile(join(root(), 'app.env.example'), 'PORT=\n');
    const report = await checkDrift({
      schema: schema(),
      root: root(),
      files: ['app.env.example'],
    });
    expect(
      report.files[0]!.problems.map((p) => [p.code, p.key ?? null]),
    ).toEqual([
      ['differs', null],
      ['missing-key', 'TOKEN'],
    ]);
  });
});

describe('checkDrift rules between variables', () => {
  const checkRulesOf = async (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files))
      await writeFile(join(root(), path), content);
    return checkDrift({ schema: rulesSchema(), root: root() });
  };

  it('reports each broken rule per file, naming keys and never a value', async () => {
    const report = await checkRulesOf({
      'app.env':
        'KEY=s3cret\nKEY_FILE=/run/key\nOLD_KEY=s3cret\nOLD_KEY_FILE=\n',
      'app.env.example': 'KEY=\nKEY_FILE=\nOLD_KEY=\nOLD_KEY_FILE=\n',
      'key.env': 'KEY=\nOLD_KEY=\n',
    });
    expect(report.ok).toBe(false);
    expect(report.files.map((file) => file.problems)).toEqual([
      [
        {
          severity: 'error',
          code: 'rule',
          key: 'KEY',
          keys: ['KEY', 'KEY_FILE'],
          message: 'set only one of them',
          fix: 'set',
        },
        {
          severity: 'error',
          code: 'rule',
          key: 'OLD_KEY',
          message: 'must differ from KEY',
          fix: 'set',
        },
      ],
      // A template holds placeholders, and its rules are not checked.
      [],
      // The file lists no alternative to KEY, so it is not required here.
      [],
    ]);
    expect(JSON.stringify(report)).not.toContain('s3cret');
  });

  it('passes when the rules hold', async () => {
    const report = await checkRulesOf({
      'app.env': 'KEY=\nKEY_FILE=/run/key\nOLD_KEY=\nOLD_KEY_FILE=\n',
      'app.env.example': 'KEY=\nKEY_FILE=\nOLD_KEY=\nOLD_KEY_FILE=\n',
      'key.env': 'KEY=a\nOLD_KEY=b\n',
    });
    expect(report.files.map((file) => file.problems)).toEqual([[], [], []]);
    expect(report.ok).toBe(true);
  });
});
