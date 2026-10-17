// `check` over the configure-env API: in-process for a local run, through
// a running serve when server.json names a live one, and against a named
// environment's server, which owns its project.

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createServer } from '@configure-env/api';
import type { InProcessOptions, StartServer } from './connect.ts';
import { compatibleVersion } from './connect.ts';
import { VERSION } from './help.ts';
import type { Io } from './io.ts';
import { main } from './main.ts';
import type { ApiServer } from './serve.ts';
import { writeServerFile } from './server-file.ts';
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

/** A loopback URL nothing listens on. */
async function closedUrl(): Promise<string> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}`;
}

const DRIFT = [
  'config/app.env: missing',
  'shared.env: missing',
  'local.env: missing',
  '3 errors, 0 warnings in 3 files',
];

describe('check, local', () => {
  it('starts the API in-process on 127.0.0.1 with a one-time token, and closes it', async () => {
    const r = await cli(['check', '--state', 'custom/state.db']);
    expect(r).toMatchObject({ code: 1, out: DRIFT, err: [], closed: 1 });
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0]).toMatchObject({
      root: dirs.root,
      schemaPath: join(dirs.root, 'env.schema.json'),
      statePath: join(dirs.root, 'custom/state.db'),
      host: '127.0.0.1',
      port: 0,
      version: VERSION,
    });
    expect(r.starts[0]!.token.length).toBeGreaterThanOrEqual(32);
    const again = await cli(['check']);
    expect(again.starts[0]!.token).not.toBe(r.starts[0]!.token);
    // Nothing is left behind: no server.json, no state folder.
    expect(await readdir(dirs.root)).toEqual(['env.schema.json']);
  });

  it('starts no server for a usage error or an invalid schema', async () => {
    const missing = await cli(['check', '--schema', 'nope.json']);
    expect(missing).toMatchObject({ code: 2, starts: [] });
    const badSet = await cli(['check', '--set', 'nope']);
    expect(badSet).toMatchObject({ code: 2, starts: [] });
    await writeFile(join(dirs.root, 'env.schema.json'), '{"version": 2}');
    expect(await cli(['check'])).toMatchObject({ code: 1, starts: [] });
  });

  it('reads a schema outside the root, as before', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'configure-env-schema-'));
    scratch.push(elsewhere);
    await writeFile(
      join(elsewhere, 'shared.schema.json'),
      JSON.stringify(CLI_SCHEMA),
    );
    const r = await cli([
      'check',
      '--schema',
      join(elsewhere, 'shared.schema.json'),
    ]);
    expect(r).toMatchObject({ code: 1, out: DRIFT });
  });

  /** A real server over the project, as a running serve would be. */
  async function runningServe(version = VERSION) {
    const server = await createServer({
      root: dirs.root,
      schemaPath: 'env.schema.json',
      port: 0,
      token: SERVER_TOKEN,
      version,
    });
    servers.push(server);
    return server;
  }

  it('goes through the running serve that server.json names', async () => {
    const server = await runningServe();
    await writeServerFile(dirs.root, {
      url: server.url,
      pid: process.pid,
      version: VERSION,
      token: SERVER_TOKEN,
    });
    const r = await cli(['check']);
    expect(r).toMatchObject({ code: 1, out: DRIFT, err: [], starts: [] });
    // Another --schema, or --state, is not the one serve serves.
    expect((await cli(['check', '--state', 'other.db'])).starts).toHaveLength(
      1,
    );
  });

  it('ignores a server.json others could have written, or one naming another machine', async () => {
    const server = await runningServe();
    const file = join(dirs.root, '.configure-env', 'server.json');
    const content = {
      url: server.url,
      pid: process.pid,
      version: VERSION,
      token: SERVER_TOKEN,
    };
    // As a clone would hold a committed one: mode 644.
    await writeServerFile(dirs.root, content);
    await chmod(file, 0o644);
    const loose = await cli(['check']);
    expect(loose).toMatchObject({ code: 1, out: DRIFT, err: [] });
    expect(loose.starts).toHaveLength(1);
    await writeServerFile(dirs.root, {
      ...content,
      url: server.url.replace('127.0.0.1', 'example.invalid'),
    });
    const elsewhere = await cli(['check']);
    expect(elsewhere).toMatchObject({ code: 1, out: DRIFT, err: [] });
    expect(elsewhere.starts).toHaveLength(1);
  });

  it('ignores a server.json whose pid is dead, or whose server is gone', async () => {
    const exited = spawnSync(process.execPath, ['-e', '']);
    expect(exited.status).toBe(0);
    const server = await runningServe();
    await writeServerFile(dirs.root, {
      url: server.url,
      pid: exited.pid!,
      version: VERSION,
      token: SERVER_TOKEN,
    });
    const dead = await cli(['check']);
    expect(dead).toMatchObject({ code: 1, out: DRIFT, err: [] });
    expect(dead.starts).toHaveLength(1);
    await writeServerFile(dirs.root, {
      url: await closedUrl(),
      pid: process.pid,
      version: VERSION,
      token: SERVER_TOKEN,
    });
    const gone = await cli(['check']);
    expect(gone).toMatchObject({ code: 1, out: DRIFT, err: [] });
    expect(gone.starts).toHaveLength(1);
  });
});

describe('check --env <name>', () => {
  let remoteRoot: string;
  let remote: ApiServer;

  /** Another project behind a server with a fixed token, stored as `staging`. */
  async function startRemote(version?: string) {
    remote = await createServer({
      root: remoteRoot,
      schemaPath: 'env.schema.json',
      port: 0,
      token: SERVER_TOKEN,
      ...(version ? { version } : {}),
    });
    servers.push(remote);
  }

  async function addStaging(url = remote.url, token = SERVER_TOKEN) {
    const added = await cli(['env', 'add', 'staging', '--url', url], {
      stdin: token,
    });
    expect(added.code).toBe(0);
  }

  beforeEach(async () => {
    remoteRoot = await mkdtemp(join(tmpdir(), 'configure-env-remote-'));
    scratch.push(remoteRoot);
    await writeFile(
      join(remoteRoot, 'env.schema.json'),
      JSON.stringify(CLI_SCHEMA),
    );
    await mkdir(join(remoteRoot, 'config'));
    await writeFile(join(remoteRoot, 'shared.env'), 'HOST=127.0.0.1\n');
  });

  it("checks the environment's project on its server, by --env or CONFIGURE_ENV_ENV", async () => {
    await startRemote();
    await addStaging();
    const expected = {
      code: 1,
      out: [
        'config/app.env: missing',
        'shared.env: PORT: is missing',
        'shared.env: MODE: is missing',
        'shared.env: DEBUG: is missing',
        'local.env: missing',
        '5 errors, 0 warnings in 3 files',
      ],
      err: [],
      starts: [],
    };
    expect(await cli(['check', '--env', 'staging'])).toMatchObject(expected);
    expect(
      await cli(['check'], { env: { CONFIGURE_ENV_ENV: 'staging' } }),
    ).toMatchObject(expected);
    // --env wins over the variable; local is this project.
    expect(
      await cli(['check', '--env', 'local'], {
        env: { CONFIGURE_ENV_ENV: 'staging' },
      }),
    ).toMatchObject({ code: 1, out: DRIFT });
  });

  it('takes --file, --set, --json and --fix there too', async () => {
    await startRemote();
    await addStaging();
    const only = await cli([
      'check',
      '--env',
      'staging',
      '--file',
      'local.env',
      '--set',
      'TOKEN=abcdefghij',
    ]);
    expect(only).toMatchObject({
      code: 1,
      out: ['local.env: missing', '1 error, 0 warnings in 1 file'],
    });
    const notListed = await cli([
      'check',
      '--env',
      'staging',
      '--file',
      'nope.env',
    ]);
    expect(notListed).toMatchObject({ code: 2 });
    expect(notListed.err[0]).toBe(
      'configure-env: nope.env: is not in the schema',
    );
    await mkdir(join(remoteRoot, '.configure-env'));
    const fixed = await cli(['check', '--env', 'staging', '--json', '--fix']);
    expect(JSON.parse(fixed.out[0]!)).toMatchObject({
      command: 'check',
      gitignore: [],
      fixed: [{ gitignore: '.configure-env/.gitignore', created: true }],
    });
  });

  it('refuses --root, --schema and --state, which are the server’s', async () => {
    await startRemote();
    await addStaging();
    for (const option of ['--root', '--schema', '--state']) {
      const r = await cli(['check', '--env', 'staging', option, 'x']);
      expect(r).toMatchObject({ code: 2, out: [] });
      expect(r.err).toEqual([
        `configure-env: ${option} does not apply to environment staging: its server owns the project`,
        `drop ${option}, or run with --env local`,
      ]);
    }
  });

  it('fails naming an environment it cannot reach, or one it does not hold', async () => {
    await startRemote();
    const url = await closedUrl();
    await addStaging(url);
    const r = await cli(['check', '--env', 'staging']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      `configure-env: cannot reach environment staging at ${url}: ECONNREFUSED`,
    ]);
    const unknown = await cli(['check', '--env', 'prod']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toEqual([
      'configure-env: no environment named prod',
      'run configure-env env list for the environments, or env add to add one',
    ]);
  });

  it('fails on a token the server refuses, never printing one', async () => {
    await startRemote();
    await addStaging(remote.url, 'not-the-token-0123456789abcdefghijk');
    const r = await cli(['check', '--env', 'staging']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'configure-env: environment staging refused the token',
      'run configure-env env remove staging, then env add it with the right token',
    ]);
    expect([...r.out, ...r.err].join('\n')).not.toContain('not-the-token');
  });

  it('refuses a server of an incompatible version, naming both', async () => {
    await startRemote('99.0.0');
    await addStaging();
    const r = await cli(['check', '--env', 'staging']);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      `configure-env: environment staging runs configure-env 99.0.0; this CLI is ${VERSION}`,
      'run a configure-env of a compatible version on either side',
    ]);
  });

  it('exits 1 on its invalid schema, naming the environment', async () => {
    await writeFile(join(remoteRoot, 'env.schema.json'), '{"version": 2}');
    await startRemote();
    await addStaging();
    const r = await cli(['check', '--env', 'staging']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      'configure-env: invalid schema staging:env.schema.json:',
    );
  });
});

describe('compatibleVersion', () => {
  it('takes the same major, and the same minor before 1.0', () => {
    expect(compatibleVersion('1.4.0', '1.2.3')).toBe(true);
    expect(compatibleVersion('2.0.0', '1.2.3')).toBe(false);
    expect(compatibleVersion('0.3.1', '0.3.0')).toBe(true);
    expect(compatibleVersion('0.4.0', '0.3.0')).toBe(false);
    expect(compatibleVersion('nonsense', '1.0.0')).toBe(false);
  });
});
