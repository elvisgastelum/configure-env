// The `within` rule through the commands: an address (or block) must lie
// inside a cidr variable's network, per file, keys only in the messages.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, useProject } from './test-helpers.ts';

const NETWORK_SCHEMA = {
  version: 1,
  variables: {
    APP_SUBNET: { type: 'cidr', family: 'ipv4', default: '172.30.250.0/24' },
    WEB_ADDRESS: {
      type: 'ipv4',
      default: '172.30.250.10',
      within: 'APP_SUBNET',
    },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*' },
    { path: '.env.example', policy: 'generate', variables: '*' },
  ],
};

const dirs = useProject(NETWORK_SCHEMA);
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const env = (content: string) => writeFile(join(dirs.root, '.env'), content);
const read = (path: string) => readFile(join(dirs.root, path), 'utf8');

const INSIDE = '172.30.250.10';
const OUTSIDE = '172.30.251.10';
const SUBNET = '172.30.250.0/24';
const leaks = (lines: string[]) =>
  [OUTSIDE, '172.30.251', SUBNET].some((value) =>
    lines.join('\n').includes(value),
  );

describe('within', () => {
  it('validate, check and list pass a value inside the network', async () => {
    await env(`APP_SUBNET=${SUBNET}\nWEB_ADDRESS=${INSIDE}\n`);
    expect((await cli(['validate', '--file', '.env'])).code).toBe(0);
    expect((await cli(['check', '--file', '.env'])).code).toBe(0);
    expect((await cli(['list', '--file', '.env'])).code).toBe(0);
  });

  it('validate, check and list report a value outside it, naming both keys', async () => {
    await env(`APP_SUBNET=${SUBNET}\nWEB_ADDRESS=${OUTSIDE}\n`);
    const validate = await cli(['validate', '--file', '.env']);
    expect(validate).toMatchObject({
      code: 1,
      out: ['.env: WEB_ADDRESS: must be within APP_SUBNET'],
    });
    const check = await cli(['check', '--file', '.env']);
    expect(check.code).toBe(1);
    expect(check.out).toContain('.env: WEB_ADDRESS: must be within APP_SUBNET');
    const list = await cli(['list', '--file', '.env']);
    expect(list.out.join('\n')).toContain('must be within APP_SUBNET');
    expect(leaks([...validate.out, ...validate.err, ...check.out])).toBe(false);
  });

  it('set refuses a value outside the network, writing nothing', async () => {
    await env(`APP_SUBNET=${SUBNET}\nWEB_ADDRESS=${INSIDE}\n`);
    const r = await cli(['set', '--file', '.env', `WEB_ADDRESS=${OUTSIDE}`]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: WEB_ADDRESS: must be within APP_SUBNET',
      'nothing was written to .env',
    ]);
    expect(await read('.env')).toBe(
      `APP_SUBNET=${SUBNET}\nWEB_ADDRESS=${INSIDE}\n`,
    );
    expect(leaks([...r.out, ...r.err])).toBe(false);
  });

  it('set refuses a network that leaves the address outside', async () => {
    await env(`APP_SUBNET=${SUBNET}\nWEB_ADDRESS=${INSIDE}\n`);
    const r = await cli(['set', '--file', '.env', 'APP_SUBNET=10.0.0.0/8']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      'configure-env: WEB_ADDRESS: must be within APP_SUBNET',
    );
    expect(
      (await cli(['set', '--file', '.env', 'APP_SUBNET=172.30.0.0/16'])).code,
    ).toBe(0);
  });

  it('apply refuses values outside the network and writes no file', async () => {
    const r = await cli(['apply', '--ci', '--set', `WEB_ADDRESS=${OUTSIDE}`]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: WEB_ADDRESS: must be within APP_SUBNET',
    ]);
    expect(leaks([...r.out, ...r.err])).toBe(false);
    expect(await readdir(dirs.root)).toEqual(['env.schema.json']);
    const ok = await cli([
      'apply',
      '--ci',
      '--set',
      'WEB_ADDRESS=172.30.250.99',
    ]);
    expect(ok.code).toBe(0);
  });

  it('refuses a schema whose default is outside the target default', async () => {
    await writeFile(
      join(dirs.root, 'env.schema.json'),
      JSON.stringify({
        ...NETWORK_SCHEMA,
        variables: {
          ...NETWORK_SCHEMA.variables,
          WEB_ADDRESS: {
            ...NETWORK_SCHEMA.variables.WEB_ADDRESS,
            default: OUTSIDE,
          },
        },
      }),
    );
    const r = await cli(['validate']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain(
      'WEB_ADDRESS must be within the default of APP_SUBNET',
    );
    expect(leaks([...r.out, ...r.err])).toBe(false);
  });
});
