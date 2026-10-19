// `apply --ci` and `apply --json` when the API refuses the run: a 409 from
// POST /api/apply (a file changed since the plan, or its generated values
// expired) and a 503 from POST /api/plan (a protected state it cannot read).
// Text output names the API's message on stderr; --json prints its document
// on stdout. Either way nothing is written and the run exits 1.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { LEGACY_STATE, run, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    NAME: { type: 'string', default: 'app' },
    SECRET: { type: 'string', secret: true },
    KEY: { type: 'string', secret: true, protected: true },
  },
  files: [
    { path: '.env', policy: 'merge', variables: ['NAME', 'SECRET'] },
    { path: 'keyed.env', policy: 'merge', variables: ['KEY'] },
  ],
};

const CHANGED =
  'the plan changed since it was shown; review it and apply again';
const EXPIRED = 'the generated values for this plan expired; run apply again';

const dirs = useProject(SCHEMA);
const path = (name: string) => join(dirs.root, name);
const read = (name: string) =>
  readFile(path(name), 'utf8').catch(() => undefined);
const exists = (name: string) =>
  stat(path(name)).then(
    () => true,
    () => false,
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Runs `before` right before the CLI's POST /api/apply reaches the server. */
function beforeApply(before: () => Promise<void> | void) {
  const fetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).pathname === '/api/apply') await before();
    return fetch(input, init);
  });
}

const cli = (argv: string[]) => run(argv, { cwd: dirs.root });

/** The --json document of a run that wrote nothing. */
const refused = (out: string[]) => {
  expect(out).toHaveLength(1);
  return JSON.parse(out[0]!) as Record<string, unknown>;
};

describe('apply when a file changed between the plan and the apply', () => {
  const edited = 'NAME=edited\n';
  const changeEnv = () => beforeApply(() => writeFile(path('.env'), edited));
  const argv = ['--file', '.env', '--set', 'SECRET=secret-value-123'];

  it('text: says so on stderr, exit 1, nothing written', async () => {
    changeEnv();
    const r = await cli(['apply', '--ci', ...argv]);
    expect(r).toEqual({ code: 1, out: [], err: [`configure-env: ${CHANGED}`] });
    expect(await read('.env')).toBe(edited);
    expect(await exists('keyed.env')).toBe(false);
  });

  it('--json: prints its document, exit 1, nothing written', async () => {
    changeEnv();
    const r = await cli(['apply', '--json', ...argv]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    expect(refused(r.out)).toEqual({
      command: 'apply',
      ok: false,
      errors: [{ kind: 'request', status: 409, message: CHANGED }],
      files: [
        {
          path: '.env',
          policy: 'merge',
          action: 'create',
          status: 'created',
          addedKeys: ['NAME', 'SECRET'],
          prunedKeys: [],
          written: false,
        },
      ],
      deferred: [],
    });
    expect(await read('.env')).toBe(edited);
    expect(await exists('keyed.env')).toBe(false);
  });
});

describe('apply when the generated values expired before the apply', () => {
  const expire = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    beforeApply(() => {
      vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
    });
  };
  const argv = ['--file', '.env', '--generate', 'SECRET'];

  it('text: says so on stderr, exit 1, nothing written', async () => {
    expire();
    const r = await cli(['apply', '--ci', ...argv]);
    expect(r).toEqual({ code: 1, out: [], err: [`configure-env: ${EXPIRED}`] });
    expect(await exists('.env')).toBe(false);
  });

  it('--json: prints its document, exit 1, nothing written', async () => {
    expire();
    const r = await cli(['apply', '--json', ...argv]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    const document = refused(r.out);
    expect(document).toMatchObject({
      command: 'apply',
      ok: false,
      errors: [{ kind: 'request', status: 409, message: EXPIRED }],
      deferred: [],
    });
    expect(document.files).toEqual([
      expect.objectContaining({ path: '.env', written: false }),
    ]);
    expect(await exists('.env')).toBe(false);
  });
});

describe('apply when the protected state cannot be read', () => {
  const breakState = async () => {
    await mkdir(path('.configure-env'));
    await writeFile(path(LEGACY_STATE), '{"version": 2}');
  };
  const message = () =>
    `invalid state ${path(LEGACY_STATE)}: version: must be 1`;
  const argv = ['--set', 'SECRET=secret-value-123', '--set', 'KEY=key-1234'];

  it('text: says so on stderr, exit 1, nothing written', async () => {
    await breakState();
    const r = await cli(['apply', '--ci', ...argv]);
    expect(r).toEqual({
      code: 1,
      out: [],
      err: [
        `configure-env: ${message()}`,
        'fix or restore it; nothing was written',
      ],
    });
    expect(await exists('.env')).toBe(false);
    expect(await exists('keyed.env')).toBe(false);
    expect(await read(LEGACY_STATE)).toBe('{"version": 2}');
  });

  it('--json: prints its document, exit 1, nothing written', async () => {
    await breakState();
    const r = await cli(['apply', '--json', ...argv]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    expect(refused(r.out)).toEqual({
      command: 'apply',
      ok: false,
      errors: [{ kind: 'request', status: 503, message: message() }],
      files: [],
      deferred: [],
    });
    expect(await exists('.env')).toBe(false);
    expect(await exists('keyed.env')).toBe(false);
    expect(await read(LEGACY_STATE)).toBe('{"version": 2}');
  });
});
