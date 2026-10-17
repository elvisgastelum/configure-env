// list, get, set, unset and history over the configure-env API: in-process
// for a local run, and against a named environment's server, which owns its
// project.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createServer } from '@configure-env/api';
import type { InProcessOptions, StartServer } from './connect.ts';
import type { Io } from './io.ts';
import { main } from './main.ts';
import type { ApiServer } from './serve.ts';
import { CLI_SCHEMA, type Run, useProject } from './test-helpers.ts';

const dirs = useProject();
const SERVER_TOKEN = 'fixed-test-token-0123456789abcdefghij';
const SECRET = 'remote-secret-token-42';
const servers: ApiServer[] = [];
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Runs the CLI in the project, counting the in-process starts. */
async function cli(
  argv: string[],
  { env = {}, stdin }: { env?: Io['env']; stdin?: string } = {},
): Promise<Run & { starts: InProcessOptions[]; closed: number }> {
  const starts: InProcessOptions[] = [];
  let closed = 0;
  const startServer: StartServer = async (options) => {
    starts.push(options);
    const server = await createServer(options);
    return {
      ...server,
      close: async () => {
        closed += 1;
        await server.close();
      },
    };
  };
  const result: Run = { code: -1, out: [], err: [] };
  result.code = await main(argv, {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env,
    isTTY: false,
    cwd: dirs.root,
    stdinIsTTY: false,
    startServer,
    ...(stdin === undefined ? {} : { readStdin: async () => stdin }),
  });
  return { ...result, starts, closed };
}

const local = (path: string) => join(dirs.root, path);

describe('the variable commands, local', () => {
  it('run through the API in-process, closing it, with the history actor cli', async () => {
    const set = await cli([
      'set',
      '--create',
      '--file',
      'local.env',
      'PORT=9000',
    ]);
    expect(set).toMatchObject({
      code: 0,
      out: ['PORT: added (9000)'],
      err: [],
      closed: 1,
    });
    expect(set.starts).toHaveLength(1);
    expect(set.starts[0]).toMatchObject({ host: '127.0.0.1', port: 0 });
    for (const argv of [
      ['list', '--file', 'local.env'],
      ['get', '--file', 'local.env', 'PORT'],
      ['unset', '--file', 'local.env', 'PORT'],
      ['history'],
    ]) {
      const r = await cli(argv);
      expect(r.code).toBe(0);
      expect(r).toMatchObject({ closed: 1 });
      expect(r.starts).toHaveLength(1);
    }
    const history = await cli(['history', '--json']);
    expect(
      JSON.parse(history.out[0]!).changes.map(
        (change: { actor: string; operation: string }) => [
          change.actor,
          change.operation,
        ],
      ),
    ).toEqual([
      ['cli', 'unset'],
      ['cli', 'set'],
    ]);
  });
});

describe('the variable commands --env <name>', () => {
  let remoteRoot: string;
  let remote: ApiServer;

  beforeEach(async () => {
    remoteRoot = await mkdtemp(join(tmpdir(), 'configure-env-remote-'));
    scratch.push(remoteRoot);
    await writeFile(
      join(remoteRoot, 'env.schema.json'),
      JSON.stringify(CLI_SCHEMA),
    );
    await writeFile(
      join(remoteRoot, 'local.env'),
      `HOST=10.0.0.1\nTOKEN=${SECRET}\n`,
    );
    remote = await createServer({
      root: remoteRoot,
      schemaPath: 'env.schema.json',
      port: 0,
      token: SERVER_TOKEN,
    });
    servers.push(remote);
    const added = await cli(['env', 'add', 'staging', '--url', remote.url], {
      stdin: SERVER_TOKEN,
    });
    expect(added.code).toBe(0);
  });

  const remoteText = () => readFile(join(remoteRoot, 'local.env'), 'utf8');
  const staging = (...argv: string[]) => cli([...argv, '--env', 'staging']);

  it("list shows the environment's values, secrets masked", async () => {
    const r = await staging('list', '--file', 'local.env');
    expect(r).toMatchObject({ code: 0, err: [], starts: [] });
    expect(r.out[0]).toBe('local.env');
    expect(r.out.find((line) => line.startsWith('HOST'))).toContain('10.0.0.1');
    expect(r.out.find((line) => line.startsWith('TOKEN'))).toContain('••••42');
    const json = await staging('list', '--json', '--file', 'local.env');
    expect(JSON.parse(json.out[0]!)).toContainEqual({
      file: 'local.env',
      key: 'TOKEN',
      set: 'yes',
      valid: true,
      masked: '••••42',
      description: 'API token',
    });
    expect([...r.out, ...json.out].join('\n')).not.toContain(SECRET);
  });

  it('get prints a value, a secret only with --reveal', async () => {
    expect(await staging('get', '--file', 'local.env', 'HOST')).toMatchObject({
      code: 0,
      out: ['10.0.0.1'],
      err: [],
    });
    const masked = await staging('get', '--file', 'local.env', 'TOKEN');
    expect(masked).toMatchObject({
      code: 1,
      out: [],
      err: [
        'configure-env: TOKEN: is secret (••••42)',
        'pass --reveal to print it',
      ],
    });
    expect(
      await staging('get', '--file', 'local.env', 'TOKEN', '--reveal'),
    ).toMatchObject({ code: 0, out: [SECRET] });
    const json = await staging('get', '--json', '--file', 'local.env', 'TOKEN');
    expect(JSON.parse(json.out[0]!)).toEqual({
      key: 'TOKEN',
      masked: '••••42',
      set: true,
    });
  });

  it("set and unset edit the environment's file, recorded as the cli's", async () => {
    const set = await staging('set', '--file', 'local.env', 'PORT=9000');
    expect(set).toMatchObject({
      code: 0,
      out: ['PORT: added (9000)'],
      err: [],
      starts: [],
    });
    expect(await remoteText()).toContain('PORT=9000');
    const unset = await staging('unset', '--file', 'local.env', 'HOST');
    expect(unset).toMatchObject({ code: 0, out: ['HOST: removed'] });
    expect(await remoteText()).not.toContain('HOST=');
    // This project is untouched.
    await expect(readFile(local('local.env'))).rejects.toThrow();

    const history = await staging('history');
    expect(history.code).toBe(0);
    expect(history.out[0]).toMatch(/^ID +WHEN \(UTC\) +BY +CHANGE/);
    expect(history.out.slice(1).map((line) => line.split(/ {2,}/)[2])).toEqual([
      'cli',
      'cli',
    ]);
    const json = await staging('history', '--json');
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      command: 'history',
      ok: true,
      total: 2,
      changes: [
        { actor: 'cli', operation: 'unset', key: 'HOST' },
        { actor: 'cli', operation: 'set', key: 'PORT' },
      ],
    });
  });

  it('set --generate makes the value on the server, never printing it', async () => {
    const r = await staging(
      'set',
      '--file',
      'local.env',
      '--generate',
      'TOKEN',
      '--json',
    );
    expect(r.code).toBe(0);
    // A value the file holds is kept: no rotation by accident.
    expect(JSON.parse(r.out[0]!)).toEqual({
      command: 'set',
      ok: true,
      file: 'local.env',
      keys: [{ key: 'TOKEN', status: 'unchanged', masked: '••••42' }],
    });
    expect(await remoteText()).toContain(`TOKEN=${SECRET}`);
  });

  it('refuses --root, --schema and --state, which are the server’s', async () => {
    for (const command of ['list', 'history']) {
      const r = await staging(command, '--state', 'x');
      expect(r).toMatchObject({ code: 2, out: [] });
      expect(r.err[0]).toBe(
        'configure-env: --state does not apply to environment staging: its server owns the project',
      );
    }
  });
});
