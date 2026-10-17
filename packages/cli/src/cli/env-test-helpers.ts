// Shared by the tests of commands that run over the configure-env API: a
// CLI runner that counts the in-process starts, and another project behind
// a real server, stored as the environment `staging`.

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vite-plus/test';
import { createServer } from '@configure-env/api';
import type { InProcessOptions, StartServer } from './connect.ts';
import type { Io, Prompts } from './io.ts';
import { main } from './main.ts';
import type { ApiServer } from './serve.ts';
import type { Run } from './test-helpers.ts';

export const SERVER_TOKEN = 'fixed-test-token-0123456789abcdefghij';

/** What a run printed, and the API servers it started in-process. */
export type ApiRun = Run & { starts: InProcessOptions[]; closed: number };

/** Starts the API in-process, as the CLI does, counting the starts. */
export function countingStart() {
  const starts: InProcessOptions[] = [];
  const counter = { closed: 0 };
  const startServer: StartServer = async (options) => {
    starts.push(options);
    const server = await createServer(options);
    return {
      ...server,
      close: async () => {
        counter.closed += 1;
        await server.close();
      },
    };
  };
  return { starts, counter, startServer };
}

/** Runs the CLI in `cwd()`, counting the in-process starts. */
export function cliIn(cwd: () => string) {
  return async (
    argv: string[],
    {
      env = {},
      stdin,
      isTTY = false,
      prompts,
    }: {
      env?: Io['env'];
      stdin?: string;
      isTTY?: boolean;
      prompts?: Prompts;
    } = {},
  ): Promise<ApiRun> => {
    const { starts, counter, startServer } = countingStart();
    const result: Run = { code: -1, out: [], err: [] };
    result.code = await main(argv, {
      stdout: (line) => result.out.push(line),
      stderr: (line) => result.err.push(line),
      env,
      isTTY,
      cwd: cwd(),
      stdinIsTTY: false,
      startServer,
      ...(prompts ? { prompts } : {}),
      ...(stdin === undefined ? {} : { readStdin: async () => stdin }),
    });
    return { ...result, starts, closed: counter.closed };
  };
}

/**
 * Another project, in a temporary directory, behind a real server with a
 * fixed token; `add` stores it as the environment `staging` of the project
 * the runner works in. Everything is removed after each test.
 */
export function useRemote() {
  const servers: ApiServer[] = [];
  const dirs: string[] = [];
  const remote = { root: '', url: '' };
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });
  return {
    remote,
    /** A new remote root, with no server yet. */
    async makeRoot(): Promise<string> {
      remote.root = await realpath(
        await mkdtemp(join(tmpdir(), 'configure-env-remote-')),
      );
      dirs.push(remote.root);
      return remote.root;
    },
    /** Starts the server over the remote root. */
    async start(): Promise<void> {
      const server = await createServer({
        root: remote.root,
        schemaPath: 'env.schema.json',
        port: 0,
        token: SERVER_TOKEN,
      });
      servers.push(server);
      remote.url = server.url;
    },
    /** Stores the server as `staging`, through env add. */
    async add(cli: ReturnType<typeof cliIn>): Promise<void> {
      const added = await cli(['env', 'add', 'staging', '--url', remote.url], {
        stdin: SERVER_TOKEN,
      });
      expect(added.code).toBe(0);
    },
  };
}
