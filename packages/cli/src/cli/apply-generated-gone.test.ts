// `apply --generate` when the server no longer holds the values its plan
// showed: the apply says why (expired, evicted, or never held by this
// server), exits 1 and writes nothing.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createServer } from '@configure-env/api';
import type { InProcessOptions, StartServer } from './connect.ts';
import { main } from './main.ts';
import type { ApiServer } from './serve.ts';
import { type Run, useProject } from './test-helpers.ts';

const dirs = useProject();
const servers: ApiServer[] = [];
const realFetch = globalThis.fetch;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

interface Planned {
  url: string;
  init: RequestInit;
}

/**
 * Runs `apply --ci --generate TOKEN` through the in-process server; before
 * the apply is sent, `between` runs and may name another server to send it to.
 */
async function applyGenerated(
  between: (
    planned: Planned,
    options: InProcessOptions,
  ) => Promise<string | void>,
): Promise<Run> {
  let options: InProcessOptions | undefined;
  let planned: Planned | undefined;
  const startServer: StartServer = async (opts) => {
    options = opts;
    return createServer(opts);
  };
  vi.stubGlobal(
    'fetch',
    async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (
        url.pathname.endsWith('/api/plan') &&
        !String(init.body).includes('"hold":false')
      )
        planned = { url: url.href, init };
      if (url.pathname.endsWith('/api/apply')) {
        const origin = await between(planned!, options!);
        if (origin) return realFetch(new URL(url.pathname, origin), init);
      }
      return realFetch(input, init);
    },
  );
  const result: Run = { code: -1, out: [], err: [] };
  result.code = await main(['apply', '--ci', '--generate', 'TOKEN'], {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env: {},
    isTTY: false,
    cwd: dirs.root,
    stdinIsTTY: false,
    startServer,
  });
  return result;
}

describe('apply --generate when the plan values are gone', () => {
  it('still applies the generated value its plan showed', async () => {
    const r = await applyGenerated(async () => undefined);
    expect(r).toEqual({
      code: 0,
      out: [
        'config/app.env: created',
        'shared.env: created',
        'local.env: created',
      ],
      err: [],
    });
    expect(await readFile(join(dirs.root, 'local.env'), 'utf8')).toMatch(
      /^TOKEN=[A-Za-z0-9_-]{48}$/m,
    );
  });

  it('says the values expired, exits 1 and writes nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = await readdir(dirs.root);
    const r = await applyGenerated(async () => {
      vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
    });
    expect(r).toEqual({
      code: 1,
      out: [],
      err: [
        'configure-env: the generated values for this plan expired; run apply again',
      ],
    });
    expect(await readdir(dirs.root)).toEqual(before);
  });

  it('says the values were evicted by newer plans, exits 1 and writes nothing', async () => {
    const before = await readdir(dirs.root);
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const r = await applyGenerated(async (planned) => {
        for (let i = 0; i < 64; i += 1)
          expect((await realFetch(planned.url, planned.init)).status).toBe(200);
      });
      expect(r).toEqual({
        code: 1,
        out: [],
        err: [
          'configure-env: the generated values for this plan were dropped to make room for 64 newer plans; run apply again',
        ],
      });
    } finally {
      write.mockRestore();
    }
    expect(await readdir(dirs.root)).toEqual(before);
  });

  it('says this server does not hold them, exits 1 and writes nothing', async () => {
    const before = await readdir(dirs.root);
    const r = await applyGenerated(async (_planned, options) => {
      // The apply reaches another instance, or the server restarted.
      const other = await createServer({ ...options, port: 0 });
      servers.push(other);
      return other.url;
    });
    expect(r).toEqual({
      code: 1,
      out: [],
      err: [
        'configure-env: this server does not hold the generated values for this plan: it restarted since the plan, or another instance made it; run apply again',
      ],
    });
    expect(await readdir(dirs.root)).toEqual(before);
  });
});
