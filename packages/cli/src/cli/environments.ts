// `configure-env env add|list|remove`: the named configure-env servers the
// CLI can run against with --env, each a URL and its token, kept in
// .configure-env/environments.json (mode 600, see local-files.ts). `local`
// is this project, never stored. No output ever holds a token.

import { resolve } from 'node:path';
import { z } from 'zod';
import {
  CliError,
  parseCommandArgs,
  printWarnings,
  usageError,
} from './common.ts';
import { ENV_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  ENVIRONMENTS_FILE,
  localFile,
  readLocalFile,
  writeLocalFile,
} from './local-files.ts';
import { isLoopback } from './serve.ts';

/** The name that always means this project, never a stored environment. */
export const LOCAL = 'local';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Environment {
  /** `http(s)://host[:port][/prefix]`, without a trailing slash. */
  url: string;
  token: string;
}

const environmentsFile = z.strictObject({
  version: z.literal(1),
  environments: z.record(
    z.string().regex(NAME),
    z.strictObject({ url: z.string().min(1), token: z.string().min(1) }),
  ),
});

type Environments = Record<string, Environment>;

/** The stored environments by name; none without the file. */
export async function readEnvironments(root: string): Promise<Environments> {
  const text = await readLocalFile(root, ENVIRONMENTS_FILE);
  if (text === undefined) return {};
  const shown = localFile(root, ENVIRONMENTS_FILE);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CliError(1, [`invalid ${shown}: not valid JSON`]);
  }
  // The issues name paths, never values: a token is never echoed.
  const result = environmentsFile.safeParse(json);
  if (!result.success)
    throw new CliError(1, [
      `invalid ${shown}: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.code}`)
        .join('; ')}`,
    ]);
  return result.data.environments;
}

const writeEnvironments = (root: string, environments: Environments) =>
  writeLocalFile(
    root,
    ENVIRONMENTS_FILE,
    `${JSON.stringify({ version: 1, environments }, null, 2)}\n`,
  );

/** An environment name, or the usage error saying what one takes. */
function checkName(name: string): string {
  if (name === LOCAL) throw usageError(`${LOCAL} is reserved for this project`);
  if (!NAME.test(name))
    throw usageError(
      `${name}: an environment name takes letters, digits, ., _ and -`,
    );
  return name;
}

/** --url as stored: http or https, no credentials, query or fragment. */
export function normalizeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw usageError(`--url takes an http or https URL, got ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw usageError(`--url takes an http or https URL, got ${value}`);
  if (url.username || url.password)
    throw usageError(
      '--url must not hold a user or password; pass the token with --token-env or stdin',
    );
  if (url.search || url.hash)
    throw usageError(`--url takes no query or fragment, got ${value}`);
  return url;
}

const urlText = (url: URL) =>
  `${url.origin}${url.pathname}`.replace(/\/+$/, '');

/** The token from --token-env, else the whole of stdin, without its line end. */
async function readToken(
  io: Io,
  name: string,
  variable: string | undefined,
): Promise<string> {
  let token: string;
  if (variable !== undefined) {
    const value = io.env[variable];
    if (!value)
      throw usageError(`--token-env ${variable}: the variable is not set`);
    token = value;
  } else {
    if (io.stdinIsTTY || !io.readStdin)
      throw usageError(
        `env add reads the token from stdin or --token-env <VAR>; pipe it in, such as: <cmd> | configure-env env add ${name} --url <url>`,
      );
    token = await io.readStdin();
  }
  token = token.replace(/\r?\n$/, '');
  if (!token.trim()) throw usageError('the token is empty');
  return token;
}

const OPTIONS = {
  url: { type: 'string' },
  'token-env': { type: 'string' },
} as const;

async function add(io: Io, root: string, args: string[], json: boolean) {
  const { values, positionals } = parseCommandArgs(args, OPTIONS);
  if (positionals.length !== 1)
    throw usageError('env add takes a name: env add <name> --url <url>');
  const name = checkName(positionals[0]!);
  if (values.url === undefined) throw usageError('env add takes --url <url>');
  const url = normalizeUrl(values.url);
  const environments = await readEnvironments(root);
  if (Object.hasOwn(environments, name))
    throw usageError(
      `environment ${name} exists`,
      `run configure-env env remove ${name} first`,
    );
  const token = await readToken(io, name, values['token-env']);
  const stored = urlText(url);
  await writeEnvironments(root, {
    ...environments,
    [name]: { url: stored, token },
  });
  if (url.protocol === 'http:' && !isLoopback(url.hostname))
    printWarnings(io, [
      `${stored} is not https: the token travels in clear text`,
    ]);
  if (json)
    io.stdout(JSON.stringify({ command: 'env add', name, url: stored }));
  else io.stdout(`Added environment ${name} at ${stored}`);
}

async function list(io: Io, root: string, json: boolean) {
  const environments = Object.entries(await readEnvironments(root));
  if (json) {
    io.stdout(
      JSON.stringify({
        command: 'env list',
        environments: environments.map(([name, { url }]) => ({ name, url })),
      }),
    );
    return;
  }
  const width = Math.max(
    LOCAL.length,
    ...environments.map(([name]) => name.length),
  );
  const line = (name: string, text: string) =>
    io.stdout(`${name.padEnd(width + 4)}${text}`);
  line(LOCAL, 'this project (the default)');
  for (const [name, { url }] of environments) line(name, url);
}

async function remove(io: Io, root: string, args: string[], json: boolean) {
  const { positionals } = parseCommandArgs(args, {});
  if (positionals.length !== 1)
    throw usageError('env remove takes a name: env remove <name>');
  const name = positionals[0]!;
  const environments = await readEnvironments(root);
  if (!Object.hasOwn(environments, name))
    throw usageError(
      `no environment named ${name}`,
      'run configure-env env list for the environments',
    );
  delete environments[name];
  await writeEnvironments(root, environments);
  if (json) io.stdout(JSON.stringify({ command: 'env remove', name }));
  else io.stdout(`Removed environment ${name}`);
}

export async function envCommand(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  // The global options parse with the subcommand's own.
  const { values } = parseCommandArgs(rest, OPTIONS);
  if (sub === undefined || sub === '--help' || sub === '-h' || values.help) {
    io.stdout(ENV_HELP);
    return 0;
  }
  const root = resolve(io.cwd, values.root ?? '.');
  const json = Boolean(values.json);
  if (sub === 'add') await add(io, root, rest, json);
  else if (sub === 'list' || sub === 'ls') await list(io, root, json);
  else if (sub === 'remove' || sub === 'rm') await remove(io, root, rest, json);
  else throw usageError(`unknown env command: ${sub}`);
  return 0;
}
