import { describe, expect, it } from 'vitest';
import { isTemplate } from '../schema/definition.ts';
import { checkDrift } from './check.ts';
import { applyPlan } from './apply.ts';
import { planChanges } from './plan.ts';
import { schemaOf, useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();

const schema = () =>
  schemaOf({
    variables: {
      PORT: { type: 'port', default: 8080 },
      TOKEN: { type: 'string', secret: true, required: true },
    },
    files: [
      {
        path: 'app.env.example',
        policy: 'generate',
        variables: '*',
        values: { TOKEN: '<token>' },
      },
      { path: 'app.env', policy: 'generate', variables: '*' },
    ],
  });

describe('isTemplate', () => {
  const file = (path: string, template?: boolean) => ({
    path,
    policy: 'merge' as const,
    variables: '*' as const,
    ...(template === undefined ? {} : { template }),
  });

  it.each([
    ['app.env.example', true],
    ['deploy/prod.sample', true],
    ['x.template', true],
    ['app.env', false],
    ['example.env', false],
  ])('reads %s by its suffix as %s', (path, expected) => {
    expect(isTemplate(file(path))).toBe(expected);
  });

  it('lets `template` override the suffix either way', () => {
    expect(isTemplate(file('app.env', true))).toBe(true);
    expect(isTemplate(file('app.env.example', false))).toBe(false);
  });

  it('is part of the schema format', () => {
    const parsed = schemaOf({
      variables: {},
      files: [
        { path: 'a.cfg', policy: 'merge', variables: '*', template: true },
      ],
    });
    expect(parsed.files[0]!.template).toBe(true);
  });
});

describe('template files', () => {
  it('never take given values: only `values` and defaults', async () => {
    const plan = await planChanges({
      schema: schema(),
      root: temp.dirs.root,
      values: { PORT: '9000', TOKEN: 'super-secret-value' },
    });
    const [example, local] = plan.files;
    expect(example!.content).toBe('PORT=8080\nTOKEN=<token>\n');
    expect(local!.content).toBe('PORT=9000\nTOKEN=super-secret-value\n');
  });

  it('stay current for check whatever values are given', async () => {
    const values = { TOKEN: 'super-secret-value' };
    await applyPlan(
      await planChanges({ schema: schema(), root: temp.dirs.root, values }),
    );
    const report = await checkDrift({
      schema: schema(),
      root: temp.dirs.root,
      values: { ...values, PORT: '9000' },
    });
    expect(report.files[0]).toMatchObject({ status: 'current', invalid: [] });
  });
});
