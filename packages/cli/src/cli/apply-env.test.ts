// `apply` over the configure-env API: in-process for a local run, and
// against a named environment's server, which owns its project and writes
// its files only.

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createServer } from '@configure-env/api';
import { DEFAULT_STATE_PATH, readChanges } from '@configure-env/core';
import type { InProcessOptions, StartServer } from './connect.ts';
import type { Io } from './io.ts';
import { main } from './main.ts';
import type { ApiServer } from './serve.ts';
import { CLI_SCHEMA, type Run, useProject } from './test-helpers.ts';

const dirs = useProject();
const SERVER_TOKEN = 'fixed-test-token-0123456789abcdefghij';
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

const read = (path: string) => readFile(path, 'utf8').catch(() => undefined);

describe('apply, local', () => {
  it('plans and applies through the API in-process, and closes it', async () => {
    const r = await cli(['apply', '--ci', '--set', 'TOKEN=abcdefghij']);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'config/app.env: created',
        'shared.env: created',
        'local.env: created',
      ],
      err: [],
      closed: 1,
    });
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0]).toMatchObject({ root: dirs.root, host: '127.0.0.1' });
    expect(await read(join(dirs.root, 'local.env'))).toContain(
      'TOKEN=abcdefghij',
    );
    // The history names the CLI.
    const rows = await readChanges(join(dirs.root, DEFAULT_STATE_PATH));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actor === 'cli')).toBe(true);
  });

  it('starts no server for a usage error', async () => {
    const r = await cli(['apply', '--ci', '--defer', 'NOPE']);
    expect(r).toMatchObject({
      code: 2,
      err: ['configure-env: NOPE: is not declared in the schema'],
      starts: [],
    });
  });
});

describe('apply --env <name>', () => {
  let remoteRoot: string;

  beforeEach(async () => {
    remoteRoot = await mkdtemp(join(tmpdir(), 'configure-env-remote-'));
    scratch.push(remoteRoot);
    await writeFile(
      join(remoteRoot, 'env.schema.json'),
      JSON.stringify(CLI_SCHEMA),
    );
    await mkdir(join(remoteRoot, 'config'));
    await writeFile(join(remoteRoot, 'shared.env'), 'HOST=127.0.0.1\n');
    const remote = await createServer({
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

  it("writes only the server's project files", async () => {
    const before = await readdir(dirs.root);
    const r = await cli([
      'apply',
      '--env',
      'staging',
      '--ci',
      '--generate',
      'TOKEN',
      '--file',
      'shared.env',
      '--file',
      'local.env',
    ]);
    expect(r).toMatchObject({
      code: 0,
      out: ['shared.env: added keys: PORT MODE DEBUG', 'local.env: created'],
      err: [],
      starts: [],
    });
    expect(await read(join(remoteRoot, 'shared.env'))).toContain('PORT=8080');
    expect(await read(join(remoteRoot, 'local.env'))).toMatch(
      /^TOKEN=[A-Za-z0-9_-]{48}$/m,
    );
    expect(await read(join(remoteRoot, 'config/app.env'))).toBeUndefined();
    // Nothing of the run lands here: no env file, no state.
    expect(await readdir(dirs.root)).toEqual(before);
    const rows = await readChanges(join(remoteRoot, DEFAULT_STATE_PATH));
    expect(rows.every((row) => row.actor === 'cli')).toBe(true);
  });

  it('reports a required value the environment lacks, writing nothing', async () => {
    const r = await cli(['apply', '--env', 'staging', '--ci']);
    expect(r).toMatchObject({
      code: 1,
      err: ['configure-env: TOKEN: is required'],
    });
    expect(await read(join(remoteRoot, 'local.env'))).toBeUndefined();
  });

  it('refuses an environment that is not stored', async () => {
    const r = await cli(['apply', '--env', 'prod', '--ci']);
    expect(r).toMatchObject({
      code: 2,
      err: [
        'configure-env: no environment named prod',
        'run configure-env env list for the environments, or env add to add one',
      ],
    });
  });

  it('refuses --root, which the server owns', async () => {
    const r = await cli(['apply', '--env', 'staging', '--ci', '--root', '.']);
    expect(r.code).toBe(2);
    expect(r.err[0]).toBe(
      'configure-env: --root does not apply to environment staging: its server owns the project',
    );
  });
});
