import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Io, main, resolveValues } from './cli.ts';
import { EXAMPLE_PATH, LOCAL_PATH, PRODUCTION_EXAMPLE_PATH } from './plan.ts';
import { DEFAULT_VALUES } from './template.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'configure-env-cli-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string[];
  err: string;
  interactiveCalls: number;
}

async function run(
  argv: string[],
  { env = {}, isTTY = false }: { env?: Io['env']; isTTY?: boolean } = {},
): Promise<Run> {
  const result: Run = { code: -1, out: [], err: '', interactiveCalls: 0 };
  result.code = await main(argv, {
    stdout: (line) => result.out.push(line),
    stderr: (line) => (result.err += `${line}\n`),
    env,
    isTTY,
    cwd: root,
    interactive: async () => {
      result.interactiveCalls += 1;
      return 0;
    },
  });
  return result;
}

describe('resolveValues', () => {
  it('takes flags first, then environment variables, then defaults', () => {
    expect(
      resolveValues(
        { 'web-port': '9000', 'contact-email': '' },
        {
          WEB_PORT: '7000',
          WEB_HOST: '10.0.0.1',
          VITE_CONTACT_EMAIL: 'env@example.com',
        },
      ),
    ).toEqual({
      WEB_HOST: '10.0.0.1',
      WEB_PORT: '9000',
      VITE_CONTACT_EMAIL: '',
      VITE_CONTACT_WHATSAPP: '',
    });
    expect(resolveValues({}, {})).toEqual(DEFAULT_VALUES);
  });

  it('treats an empty environment variable as unset', () => {
    expect(resolveValues({}, { WEB_HOST: '' }).WEB_HOST).toBe('127.0.0.1');
  });
});

describe('main --ci', () => {
  it('writes the examples on a fresh root, one stable line per file', async () => {
    const r = await run(['--ci', '--root', root]);
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: created`,
      `${EXAMPLE_PATH}: created`,
    ]);
    const again = await run(['--ci', '--root', root]);
    expect(again.out).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: unchanged`,
      `${EXAMPLE_PATH}: unchanged`,
    ]);
  });

  it('runs unattended when CI=true, without --ci', async () => {
    const r = await run(['--root', root], { env: { CI: 'true' } });
    expect(r.code).toBe(0);
    expect(r.interactiveCalls).toBe(0);
  });

  it('accepts a leading -- passed through by pnpm', async () => {
    expect((await run(['--', '--ci', '--root', root])).code).toBe(0);
  });

  it('resolves a relative --root against the cwd', async () => {
    expect((await run(['--ci', '--root', '.'])).code).toBe(0);
    await expect(stat(join(root, EXAMPLE_PATH))).resolves.toBeTruthy();
  });

  it('writes .env only with --local, from flags and environment variables', async () => {
    await run(['--ci', '--root', root]);
    await expect(stat(join(root, LOCAL_PATH))).rejects.toThrow();
    const r = await run(
      ['--ci', '--local', '--root', root, '--web-port', '9000'],
      {
        env: { WEB_HOST: '0.0.0.0' },
      },
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${LOCAL_PATH}: created`);
    const path = join(root, LOCAL_PATH);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const content = await readFile(path, 'utf8');
    expect(content).toContain('\nWEB_PORT=9000\n');
    expect(content).toContain('WEB_HOST=0.0.0.0\n');
  });

  it('never overwrites an existing .env', async () => {
    await writeFile(join(root, LOCAL_PATH), 'KEEP_ME=1\n');
    const r = await run(['--ci', '--local', '--root', root]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      `${LOCAL_PATH}: unchanged (exists; never overwritten)`,
    );
    expect(await readFile(join(root, LOCAL_PATH), 'utf8')).toBe('KEEP_ME=1\n');
  });

  it('exits 1 on an invalid value and writes nothing', async () => {
    const r = await run([
      '--ci',
      '--local',
      '--root',
      root,
      '--web-port',
      '70000',
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('WEB_PORT');
    await expect(stat(join(root, EXAMPLE_PATH))).rejects.toThrow();
  });

  it('exits 1 on an invalid environment value when .env is a target', async () => {
    const r = await run(['--ci', '--local', '--root', root], {
      env: { VITE_CONTACT_WHATSAPP: 'maybe' },
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain('VITE_CONTACT_WHATSAPP');
  });
});

describe('main --check', () => {
  it('exits 1 and names the drift on an empty root, writing nothing', async () => {
    const r = await run(['--ci', '--check', '--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: missing`,
      `${EXAMPLE_PATH}: missing`,
    ]);
    await expect(stat(join(root, 'deploy'))).rejects.toThrow();
  });

  it('exits 0 once the files are current, and ignores --local', async () => {
    await run(['--ci', '--root', root]);
    const r = await run(['--ci', '--check', '--local', '--root', root]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: current`,
      `${EXAMPLE_PATH}: current`,
    ]);
    await expect(stat(join(root, LOCAL_PATH))).rejects.toThrow();
  });
});

describe('main usage', () => {
  it.each([[['--nope']], [['--ci', 'positional']], [['--ci', '--root']]])(
    'exits 2 on bad arguments %j',
    async (argv) => {
      const r = await run(argv);
      expect(r.code).toBe(2);
      expect(r.err).toContain('configure-env:');
    },
  );

  it('exits 2 on a missing root', async () => {
    const r = await run(['--ci', '--root', join(root, 'missing')]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('no such directory');
  });

  it('exits 2 without a TTY or --ci, with a hint', async () => {
    const r = await run(['--root', root]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--ci');
    expect(r.interactiveCalls).toBe(0);
  });

  it('runs the interactive flow on a TTY', async () => {
    const r = await run(['--root', root], { isTTY: true });
    expect(r.code).toBe(0);
    expect(r.interactiveCalls).toBe(1);
  });

  it('prints help and exits 0', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain('--ci');
  });
});

describe('the cli entry point', () => {
  it('runs under tsx', () => {
    const pkg = fileURLToPath(new URL('..', import.meta.url));
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', '--ci', '--root', root],
      { cwd: pkg, encoding: 'utf8', env: { ...process.env, CI: '' } },
    );
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(child.stdout).toBe(
      `${PRODUCTION_EXAMPLE_PATH}: created\n${EXAMPLE_PATH}: created\n`,
    );
  });
});
