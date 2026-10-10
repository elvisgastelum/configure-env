// Template files (example, sample and template files) hold placeholders and
// defaults only: no value a person or the environment gives reaches them.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDotenv, getValue } from '../engine/dotenv.ts';
import { run, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject({
  version: 1,
  variables: {
    PORT: { type: 'port', default: 8080 },
    TOKEN: { type: 'string', secret: true, required: true },
    SAMPLE_ONLY: { type: 'string', default: 'placeholder' },
  },
  files: [
    {
      path: 'app.env.example',
      policy: 'generate',
      variables: '*',
      values: { TOKEN: '<token>' },
    },
    {
      path: 'settings.cfg',
      policy: 'merge',
      template: true,
      variables: ['SAMPLE_ONLY'],
    },
    { path: 'app.env', policy: 'generate', variables: ['PORT', 'TOKEN'] },
  ],
});
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const valueIn = async (path: string, key: string) =>
  getValue(parseDotenv(await readFile(join(dirs.root, path), 'utf8')), key);

describe('template files', () => {
  it('take no --set or environment value in apply --ci', async () => {
    const r = await cli(
      ['apply', '--ci', '--set', 'TOKEN=abcdefghij', '--set', 'SAMPLE_ONLY=x'],
      { env: { PORT: '9000' } },
    );
    expect(r.code).toBe(0);
    expect(await valueIn('app.env.example', 'TOKEN')).toBe('<token>');
    expect(await valueIn('app.env.example', 'PORT')).toBe('8080');
    expect(await valueIn('settings.cfg', 'SAMPLE_ONLY')).toBe('placeholder');
    expect(await valueIn('app.env', 'TOKEN')).toBe('abcdefghij');
    expect(await valueIn('app.env', 'PORT')).toBe('9000');
  });

  it('need no value for a required variable only they hold', async () => {
    const r = await cli(['apply', '--ci', '--file', 'app.env.example']);
    expect(r).toMatchObject({ code: 0, out: ['app.env.example: created'] });
  });

  it('get no prompts and no prompted values in the terminal', async () => {
    const { prompts, calls } = scriptedPrompts({
      'Which files': ['app.env.example', 'settings.cfg'],
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls.map((c) => c.kind)).toEqual(['multiselect', 'confirm']);
    expect(await valueIn('app.env.example', 'TOKEN')).toBe('<token>');
  });

  it('keep prompted values out while the other files take them', async () => {
    const { prompts, calls } = scriptedPrompts({
      TOKEN: 'prompted-secret',
      PORT: '7000',
    });
    const r = await cli(['apply'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls.map((c) => c.message)).not.toContain('SAMPLE_ONLY');
    expect(await valueIn('app.env', 'TOKEN')).toBe('prompted-secret');
    expect(await valueIn('app.env.example', 'TOKEN')).toBe('<token>');
    expect(await valueIn('app.env.example', 'PORT')).toBe('8080');
  });
});
