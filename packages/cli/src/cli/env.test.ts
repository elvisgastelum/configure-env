// `configure-env env add|list|remove`: the named environments in
// .configure-env/environments.json, mode 600, whose tokens never print.

import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { run, useProject } from './test-helpers.ts';

const dirs = useProject();
const cli = (
  argv: string[],
  options: Omit<Parameters<typeof run>[1], 'cwd'> = {},
) => run(argv, { cwd: dirs.root, ...options });
const FILE = '.configure-env/environments.json';
const TOKEN = 't0ken-'.repeat(8);
const URL = 'https://envs.example.com';

const stored = async () =>
  JSON.parse(await readFile(join(dirs.root, FILE), 'utf8')) as unknown;
const modeOf = async (path: string) =>
  (await stat(join(dirs.root, path))).mode & 0o777;
const printed = (r: { out: string[]; err: string[] }) =>
  [...r.out, ...r.err].join('\n');

describe('env add', () => {
  it('stores the URL and the token from --token-env, mode 600, printing no token', async () => {
    const r = await cli(
      ['env', 'add', 'prod', '--url', `${URL}/`, '--token-env', 'PROD_TOKEN'],
      { env: { PROD_TOKEN: TOKEN } },
    );
    expect(r).toMatchObject({
      code: 0,
      out: [`Added environment prod at ${URL}`],
      err: [],
    });
    expect(await stored()).toEqual({
      version: 1,
      environments: { prod: { url: URL, token: TOKEN } },
    });
    expect(await modeOf(FILE)).toBe(0o600);
    expect(await modeOf('.configure-env')).toBe(0o700);
    expect(printed(r)).not.toContain(TOKEN);
  });

  it('reads the token from stdin, without its line end', async () => {
    const r = await cli(['env', 'add', 'staging', '--url', URL], {
      stdin: `${TOKEN}\n`,
    });
    expect(r.code).toBe(0);
    expect(await stored()).toMatchObject({
      environments: { staging: { url: URL, token: TOKEN } },
    });
  });

  it('keeps the file out of git through the state folder .gitignore', async () => {
    await cli(['env', 'add', 'prod', '--url', URL], { stdin: TOKEN });
    const ignore = await readFile(
      join(dirs.root, '.configure-env/.gitignore'),
      'utf8',
    );
    expect(ignore.split('\n')).toEqual(
      expect.arrayContaining(['state.db', 'environments.json', 'server.json']),
    );
    // An existing one gains the lines it lacks, keeping its own.
    await writeFile(join(dirs.root, '.configure-env/.gitignore'), 'mine\n');
    await cli(['env', 'add', 'qa', '--url', URL], { stdin: TOKEN });
    expect(
      await readFile(join(dirs.root, '.configure-env/.gitignore'), 'utf8'),
    ).toBe('mine\nenvironments.json\nserver.json\n');
  });

  it('prints the environment without its token in --json', async () => {
    const r = await cli(['env', 'add', 'prod', '--url', URL, '--json'], {
      stdin: TOKEN,
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out[0]!)).toEqual({
      command: 'env add',
      name: 'prod',
      url: URL,
    });
    expect(printed(r)).not.toContain(TOKEN);
  });

  it('warns that a token sent over plain http to another machine travels in clear', async () => {
    const r = await cli(
      ['env', 'add', 'lan', '--url', 'http://10.0.0.5:4747'],
      { stdin: TOKEN },
    );
    expect(r.code).toBe(0);
    expect(r.err).toEqual([
      'configure-env: warning: http://10.0.0.5:4747 is not https: the token travels in clear text',
    ]);
    const loopback = await cli(
      ['env', 'add', 'here', '--url', 'http://127.0.0.1:4747'],
      { stdin: TOKEN },
    );
    expect(loopback.err).toEqual([]);
  });

  it.each([
    [
      ['env', 'add', 'local', '--url', URL],
      'local is reserved for this project',
    ],
    [
      ['env', 'add', 'bad name', '--url', URL],
      'bad name: an environment name takes letters, digits, ., _ and -',
    ],
    [['env', 'add', 'prod'], 'env add takes --url <url>'],
    [
      ['env', 'add', '--url', URL],
      'env add takes a name: env add <name> --url <url>',
    ],
    [
      ['env', 'add', 'prod', '--url', 'ftp://x'],
      '--url takes an http or https URL, got ftp://x',
    ],
    [
      ['env', 'add', 'prod', '--url', 'https://u:p@x'],
      '--url must not hold a user or password; pass the token with --token-env or stdin',
    ],
  ])('refuses %j with a usage error', async (argv, message) => {
    const r = await cli(argv, { stdin: TOKEN });
    expect(r).toMatchObject({ code: 2, out: [] });
    expect(r.err[0]).toBe(`configure-env: ${message}`);
    await expect(stat(join(dirs.root, FILE))).rejects.toThrow();
  });

  it('refuses a token it cannot get, and an empty one', async () => {
    const unset = await cli([
      'env',
      'add',
      'prod',
      '--url',
      URL,
      '--token-env',
      'NOPE',
    ]);
    expect(unset).toMatchObject({ code: 2 });
    expect(unset.err[0]).toBe(
      'configure-env: --token-env NOPE: the variable is not set',
    );
    const terminal = await cli(['env', 'add', 'prod', '--url', URL], {
      stdinIsTTY: true,
    });
    expect(terminal.code).toBe(2);
    expect(terminal.err[0]).toBe(
      'configure-env: env add reads the token from stdin or --token-env <VAR>; pipe it in, such as: <cmd> | configure-env env add prod --url <url>',
    );
    const empty = await cli(['env', 'add', 'prod', '--url', URL], {
      stdin: '\n',
    });
    expect(empty.code).toBe(2);
    expect(empty.err[0]).toBe('configure-env: the token is empty');
  });

  it('refuses a name it already holds', async () => {
    await cli(['env', 'add', 'prod', '--url', URL], { stdin: TOKEN });
    const r = await cli(['env', 'add', 'prod', '--url', 'https://other'], {
      stdin: 'other-token',
    });
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      'configure-env: environment prod exists',
      'run configure-env env remove prod first',
    ]);
    expect(await stored()).toMatchObject({
      environments: { prod: { url: URL, token: TOKEN } },
    });
  });
});

describe('env list', () => {
  it('lists each name and URL, never a token', async () => {
    await cli(['env', 'add', 'prod', '--url', URL], { stdin: TOKEN });
    await cli(['env', 'add', 'qa', '--url', 'https://qa.example.com'], {
      stdin: TOKEN,
    });
    const r = await cli(['env', 'list']);
    expect(r).toMatchObject({
      code: 0,
      out: [
        'local    this project (the default)',
        `prod     ${URL}`,
        'qa       https://qa.example.com',
      ],
      err: [],
    });
    const json = await cli(['env', 'list', '--json']);
    expect(JSON.parse(json.out[0]!)).toEqual({
      command: 'env list',
      environments: [
        { name: 'prod', url: URL },
        { name: 'qa', url: 'https://qa.example.com' },
      ],
    });
    expect(printed(r) + printed(json)).not.toContain(TOKEN);
  });

  it('lists only local without the file', async () => {
    expect(await cli(['env', 'list'])).toMatchObject({
      code: 0,
      out: ['local    this project (the default)'],
    });
  });

  it('exits 1 on a file it cannot read, never printing it', async () => {
    await mkdir(join(dirs.root, '.configure-env'));
    await writeFile(join(dirs.root, FILE), `{"token": "${TOKEN}"`);
    const r = await cli(['env', 'list']);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      `configure-env: invalid ${join(dirs.root, FILE)}: not valid JSON`,
    );
    expect(printed(r)).not.toContain(TOKEN);
  });
});

describe('env remove', () => {
  it('removes one environment, keeping the others', async () => {
    await cli(['env', 'add', 'prod', '--url', URL], { stdin: TOKEN });
    await cli(['env', 'add', 'qa', '--url', URL], { stdin: TOKEN });
    expect(await cli(['env', 'remove', 'prod'])).toMatchObject({
      code: 0,
      out: ['Removed environment prod'],
    });
    expect(await stored()).toEqual({
      version: 1,
      environments: { qa: { url: URL, token: TOKEN } },
    });
    expect(await modeOf(FILE)).toBe(0o600);
  });

  it('exits 2 for a name it does not hold', async () => {
    const r = await cli(['env', 'remove', 'prod']);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      'configure-env: no environment named prod',
      'run configure-env env list for the environments',
    ]);
  });
});

describe('env', () => {
  it('prints its help, and exits 2 on an unknown subcommand', async () => {
    const help = await cli(['env', '--help']);
    expect(help.code).toBe(0);
    expect(help.out.join('\n')).toContain(
      'Usage: configure-env env <add|list|remove>',
    );
    expect((await cli(['env'])).out).toEqual(help.out);
    const bad = await cli(['env', 'frob']);
    expect(bad.code).toBe(2);
    expect(bad.err[0]).toBe('configure-env: unknown env command: frob');
  });

  it('is listed in the main help, with --env', async () => {
    const help = (await cli(['--help'])).out.join('\n');
    expect(help).toContain('env       ');
    expect(help).toContain('--env <name>');
  });
});

describe('--env and CONFIGURE_ENV_ENV on a local-only command', () => {
  it('refuse any environment but local, writing nothing', async () => {
    const flag = await cli(['serve', '--env', 'prod']);
    expect(flag).toMatchObject({ code: 2, out: [] });
    expect(flag.err).toEqual([
      'configure-env: --env prod: this command runs on the local project only; apply, check, init, list, get, set, unset and history run against an environment',
      'drop --env to run it here',
    ]);
    const variable = await cli(['serve'], {
      env: { CONFIGURE_ENV_ENV: 'prod' },
    });
    expect(variable.code).toBe(2);
    expect(variable.err).toEqual([
      'configure-env: CONFIGURE_ENV_ENV prod: this command runs on the local project only; apply, check, init, list, get, set, unset and history run against an environment',
      'unset CONFIGURE_ENV_ENV to run it here',
    ]);
    await expect(stat(join(dirs.root, 'shared.env'))).rejects.toThrow();
  });

  it('run as before for local, named or not', async () => {
    const token = ['--set', 'TOKEN=abcdefghij'];
    expect((await cli(['apply', '--ci', ...token])).code).toBe(0);
    expect(
      (await cli(['apply', '--ci', '--env', 'local', ...token])).code,
    ).toBe(0);
    expect(
      (
        await cli(['apply', '--ci', ...token], {
          env: { CONFIGURE_ENV_ENV: 'local' },
        })
      ).code,
    ).toBe(0);
  });
});
