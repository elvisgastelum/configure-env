// `init` over the configure-env API: in-process for a local run, and
// against a named environment's server, which owns its project.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { readChanges } from '@configure-env/core';
import { VERSION } from './help.ts';
import { cliIn, useRemote } from './env-test-helpers.ts';
import { STATE, scriptedPrompts, useProject } from './test-helpers.ts';

const dirs = useProject(null);
const cli = cliIn(() => dirs.root);
const { remote, makeRoot, start, add } = useRemote();

const remoteText = (path = 'env.schema.json') =>
  readFile(join(remote.root, path), 'utf8');

describe('init, local', () => {
  it('writes through the API in-process, recording the change as the cli’s', async () => {
    await writeFile(join(dirs.root, 'example.env'), 'PORT=8080\n');
    const r = await cli(['init', '--ci', '--from', 'example.env']);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'Wrote env.schema.json: 1 variable from example.env',
        'Created .gitignore with .configure-env/',
      ],
      err: [],
      closed: 1,
    });
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0]).toMatchObject({
      root: dirs.root,
      schemaPath: join(dirs.root, 'env.schema.json'),
      host: '127.0.0.1',
      port: 0,
      version: VERSION,
    });
    expect(await readChanges(join(dirs.root, STATE))).toMatchObject([
      { actor: 'cli', file: 'env.schema.json', operation: 'schema' },
    ]);
  });

  it('starts no server for a usage error', async () => {
    const r = await cli(['init', '--nope']);
    expect(r).toMatchObject({ code: 2, starts: [] });
    expect(await readdir(dirs.root)).toEqual([]);
  });
});

describe('init --env <name>', () => {
  it("writes the schema on the environment's server, as the cli", async () => {
    await makeRoot();
    await writeFile(join(remote.root, 'example.env'), 'PORT=8080\nNAME=web\n');
    await start();
    await add(cli);
    const r = await cli([
      'init',
      '--env',
      'staging',
      '--ci',
      '--from',
      'example.env',
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'Wrote staging:env.schema.json: 2 variables from example.env',
        'Created .gitignore with .configure-env/',
      ],
      err: [],
      starts: [],
    });
    expect(JSON.parse(await remoteText())).toMatchObject({
      variables: {
        PORT: { type: 'integer', default: 8080 },
        NAME: { type: 'string', default: 'web' },
      },
      files: [{ path: 'example.env', policy: 'merge', variables: '*' }],
    });
    expect(await remoteText('.gitignore')).toBe('.configure-env/\n');
    expect(await readChanges(join(remote.root, STATE))).toMatchObject([
      { actor: 'cli', file: 'env.schema.json', operation: 'schema' },
    ]);
    // Nothing is written here.
    expect(await readdir(dirs.root)).toEqual(['.configure-env']);
    expect((await readdir(join(dirs.root, '.configure-env'))).sort()).toEqual([
      '.gitignore',
      'environments.json',
    ]);
  });

  it('refuses to overwrite its schema unless --force, then replaces it', async () => {
    await makeRoot();
    await writeFile(join(remote.root, 'env.schema.json'), '{"version": 1}\n');
    await writeFile(join(remote.root, 'example.env'), 'A=1\n');
    await start();
    await add(cli);
    const refused = await cli(['init', '--env', 'staging', '--ci']);
    expect(refused).toMatchObject({ code: 2, out: [] });
    expect(refused.err).toEqual([
      'configure-env: staging:env.schema.json exists; pass --force to overwrite it',
    ]);
    expect(await remoteText()).toBe('{"version": 1}\n');
    const forced = await cli([
      'init',
      '--env',
      'staging',
      '--json',
      '--force',
      '--from',
      'example.env',
    ]);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.out[0]!)).toEqual({
      command: 'init',
      ok: true,
      schema: 'staging:env.schema.json',
      from: 'example.env',
      variables: ['A'],
      gitignore: 'created',
    });
    expect(JSON.parse(await remoteText()).variables).toEqual({
      A: { type: 'integer', default: 1 },
    });
  });

  it('exits 2 for a --from that is missing or outside its root', async () => {
    await makeRoot();
    await start();
    await add(cli);
    const missing = await cli([
      'init',
      '--env',
      'staging',
      '--ci',
      '--from',
      'nope.env',
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toEqual([
      'configure-env: --from: no such file: nope.env',
    ]);
    const outside = await cli([
      'init',
      '--env',
      'staging',
      '--ci',
      '--from',
      '../x.env',
    ]);
    expect(outside.code).toBe(2);
    expect(outside.err).toEqual([
      'configure-env: --from must name a file inside the root: ../x.env',
    ]);
    expect(await readdir(remote.root)).toEqual([]);
  });

  it('lets the person review the types the server inferred', async () => {
    await makeRoot();
    await writeFile(join(remote.root, '.env.example'), 'PORT=8080\nNAME=web\n');
    await start();
    await add(cli);
    const { prompts, calls, logs } = scriptedPrompts({
      'Use these types?': false,
      PORT: 'port',
      NAME: 'integer',
    });
    const r = await cli(['init', '--env', 'staging'], { isTTY: true, prompts });
    expect(r.code).toBe(0);
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(2);
    expect(logs).toContain(
      'note: Inferred from .env.example: PORT: integer (8080)\nNAME: string (web)',
    );
    expect(JSON.parse(await remoteText()).variables).toEqual({
      PORT: { type: 'port', default: 8080 },
      NAME: { type: 'integer' },
    });
  });

  it('writes nothing there when the person cancels', async () => {
    await makeRoot();
    await writeFile(join(remote.root, '.env.example'), 'PORT=8080\n');
    await start();
    await add(cli);
    const { prompts } = scriptedPrompts({ 'Use these types?': 'cancel' });
    const r = await cli(['init', '--env', 'staging'], { isTTY: true, prompts });
    expect(r.code).toBe(130);
    expect(await readdir(remote.root)).toEqual(['.env.example']);
  });

  it('refuses --root, --schema and --state, which are the server’s', async () => {
    await makeRoot();
    await start();
    await add(cli);
    for (const option of ['--root', '--schema', '--state']) {
      const r = await cli(['init', '--env', 'staging', '--ci', option, 'x']);
      expect(r).toMatchObject({ code: 2, out: [] });
      expect(r.err[0]).toBe(
        `configure-env: ${option} does not apply to environment staging: its server owns the project`,
      );
    }
    expect(await readdir(remote.root)).toEqual([]);
  });
});
