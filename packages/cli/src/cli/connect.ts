// Where a command that runs over the configure-env API sends its requests:
// the environment --env (or CONFIGURE_ENV_ENV) names, `local` by default.
//
// - local: the project's running `serve`, when .configure-env/server.json
//   names a live pid of this version whose server answers for this root and
//   schema; else the API in-process on 127.0.0.1, port 0, with a one-time
//   token and --root, --schema and --state applied, closed when the command
//   ends. No daemon.
// - another name: the server env add stored, which owns its project, so
//   --root, --schema and --state are refused; one whose version this CLI is
//   not compatible with is refused too.
//
// The schema is read locally first for `local`, as every command reads it,
// so a missing or invalid one fails before any server starts.

import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  type ApiTarget,
  getHealth,
  getProject,
  getSchema,
} from '@configure-env/api-client/client';
import {
  DEFAULT_STATE_PATH,
  type EnvSchema,
  displayPath,
  parseSchema,
} from '@configure-env/core';
import {
  CliError,
  type Context,
  checkSchemaFiles,
  contextOf,
  isCiEnv,
  loadContextSchema,
  selectedEnvironment,
  usageError,
} from './common.ts';
import { type Environment, LOCAL, readEnvironments } from './environments.ts';
import { VERSION } from './help.ts';
import type { Io, Prompts } from './io.ts';
import { loadServer } from './load-server.js';
import { clackPrompts } from './prompts.ts';
import type { ApiServer, ServerOptions } from './serve.ts';
import { isRunning, readServerFile } from './server-file.ts';

/** The X-Configure-Env-Client header of the CLI's requests. */
export const CLIENT = 'cli';
/** How long attaching waits for a running serve to answer its health check. */
const ATTACH_TIMEOUT_MS = 2_000;
/** How long a request to another machine may take. */
const REMOTE_TIMEOUT_MS = 30_000;

/**
 * What createServer takes beyond serve's options: the state the CLI was
 * given, and its schema wherever it lies (see the API's createServer).
 */
export interface InProcessOptions extends ServerOptions {
  statePath: string;
  schemaAnywhere: true;
}

/** Starts the API in-process; tests replace it to watch the starts. */
export type StartServer = (options: InProcessOptions) => Promise<ApiServer>;

const startInProcess: StartServer = async (options) =>
  (await loadServer()).createServer(options);

/** A server the command talks to, closed when the command ends. */
export interface Connection {
  /** `local`, or the stored environment's name. */
  name: string;
  target: ApiTarget;
  /** Request options: the target, with a timeout for another machine. */
  init(): { target: ApiTarget; signal?: AbortSignal };
  close(): Promise<void>;
}

/** A project a command works on, before or after it connects. */
export interface ProjectRun {
  /** `local` or the environment's name. */
  name: string;
  /** Whether the server owns the project (another environment). */
  remote: boolean;
  schema: EnvSchema;
  /** The schema as the terminal title names it. */
  title: string;
  /** The --file paths; every file when absent. */
  files?: string[];
  ci: boolean;
  json: boolean;
  prompts: Prompts;
  /** The server to send requests to: started, attached, or the remote one. */
  connect(): Promise<Connection>;
}

type GlobalValues = Parameters<typeof contextOf>[1] & { env?: string };

const requestFailure = (error: unknown) => {
  const cause = (error as { cause?: NodeJS.ErrnoException }).cause;
  if ((error as Error).name === 'TimeoutError') return 'timed out';
  return cause?.code ?? cause?.message ?? (error as Error).message;
};

/**
 * Runs one request of `connection`, mapping what fails: a server that
 * cannot be reached, a refused token, or an answer that is not JSON.
 */
export async function send<T extends { status: number; data: unknown }>(
  connection: Pick<Connection, 'name' | 'target'>,
  request: () => Promise<T>,
): Promise<T> {
  let response: T;
  try {
    response = await request();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new CliError(1, [
        `environment ${connection.name} at ${connection.target.baseUrl} did not answer as a configure-env server`,
      ]);
    throw new CliError(1, [
      `cannot reach environment ${connection.name} at ${connection.target.baseUrl}: ${requestFailure(error)}`,
    ]);
  }
  if (response.status === 401)
    throw new CliError(1, [
      `environment ${connection.name} refused the token`,
      `run configure-env env remove ${connection.name}, then env add it with the right token`,
    ]);
  return response;
}

/** The message of an error answer, or a line naming its status. */
export const answerMessage = (response: { status: number; data: unknown }) => {
  const message = (response.data as { message?: unknown } | null)?.message;
  return typeof message === 'string'
    ? message
    : `the server answered ${response.status}`;
};

const versionParts = (version: string) =>
  version.split(/[.+-]/).slice(0, 2).map(Number);

/** Same major, and the same minor before 1.0: what this CLI can talk to. */
export function compatibleVersion(server: string, cli = VERSION): boolean {
  const [major, minor] = versionParts(server);
  const [ownMajor, ownMinor] = versionParts(cli);
  if (major === undefined || Number.isNaN(major) || major !== ownMajor)
    return false;
  return ownMajor !== 0 || minor === ownMinor;
}

function connectionTo(name: string, target: ApiTarget, timeoutMs?: number) {
  return {
    name,
    target,
    init: () => ({
      target,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    }),
    close: async () => {},
  } satisfies Connection;
}

/** The project's running serve, when it answers for this project. */
async function attach(context: Context): Promise<Connection | undefined> {
  // serve keeps the state at the default path; another --state is not its.
  if (context.statePath !== resolve(context.root, DEFAULT_STATE_PATH))
    return undefined;
  const file = await readServerFile(context.root);
  if (!file || !isRunning(file.pid) || file.version !== VERSION)
    return undefined;
  const connection = connectionTo(
    LOCAL,
    { baseUrl: file.url, token: file.token, client: CLIENT },
    ATTACH_TIMEOUT_MS,
  );
  try {
    const health = await getHealth(connection.init());
    if (health.status !== 200) return undefined;
    const project = await getProject(connection.init());
    if (project.status !== 200) return undefined;
    const root = await realpath(context.root);
    const schemaPath = relative(context.root, context.schemaPath)
      .split(sep)
      .join('/');
    if (
      project.data.root !== root ||
      project.data.schemaPath !== schemaPath ||
      project.data.version !== VERSION
    )
      return undefined;
  } catch {
    return undefined;
  }
  return connectionTo(LOCAL, connection.target);
}

/** The API in-process for this run, over the paths the person gave. */
async function startLocal(
  context: Context,
  start: StartServer,
): Promise<Connection> {
  const token = randomBytes(32).toString('base64url');
  const server = await start({
    root: context.root,
    schemaPath: context.schemaPath,
    statePath: context.statePath,
    schemaAnywhere: true,
    host: '127.0.0.1',
    port: 0,
    token,
    version: VERSION,
  });
  return {
    ...connectionTo(LOCAL, { baseUrl: server.url, token, client: CLIENT }),
    close: () => server.close(),
  };
}

/** The project of the local environment: read here, served by its API. */
async function localRun(io: Io, values: GlobalValues): Promise<ProjectRun> {
  const context = await contextOf(io, values);
  const schema = await loadContextSchema(context);
  return {
    name: LOCAL,
    remote: false,
    schema,
    title: displayPath(io.cwd, context.schemaPath),
    ...(context.files ? { files: context.files } : {}),
    ci: context.ci,
    json: context.json,
    prompts: context.prompts,
    connect: async () =>
      (await attach(context)) ??
      startLocal(context, io.startServer ?? startInProcess),
  };
}

/** The stored environment, or the usage error naming the ones there are. */
async function storedEnvironment(io: Io, name: string): Promise<Environment> {
  const environments = await readEnvironments(resolve(io.cwd));
  const environment = Object.hasOwn(environments, name)
    ? environments[name]
    : undefined;
  if (!environment)
    throw usageError(
      `no environment named ${name}`,
      'run configure-env env list for the environments, or env add to add one',
    );
  return environment;
}

/** The project of another environment: its server's, read through it. */
async function remoteRun(
  io: Io,
  values: GlobalValues,
  name: string,
): Promise<ProjectRun> {
  for (const option of ['root', 'schema', 'state'] as const)
    if (values[option] !== undefined)
      throw usageError(
        `--${option} does not apply to environment ${name}: its server owns the project`,
        `drop --${option}, or run with --env ${LOCAL}`,
      );
  if (values['no-color']) io.env.NO_COLOR = '1';
  const environment = await storedEnvironment(io, name);
  const connection = connectionTo(
    name,
    { baseUrl: environment.url, token: environment.token, client: CLIENT },
    REMOTE_TIMEOUT_MS,
  );
  const project = await send(connection, () => getProject(connection.init()));
  if (project.status !== 200 || typeof project.data?.version !== 'string')
    throw new CliError(1, [
      `environment ${name} at ${environment.url} did not answer as a configure-env server`,
    ]);
  const version = project.data.version;
  if (!compatibleVersion(version))
    throw new CliError(1, [
      `environment ${name} runs configure-env ${version}; this CLI is ${VERSION}`,
      'run a configure-env of a compatible version on either side',
    ]);
  const read = await send(connection, () => getSchema(connection.init()));
  if (read.status !== 200)
    throw new CliError(1, [`${name}: ${answerMessage(read)}`]);
  const shown = `${name}:${read.data.path}`;
  const parsed = read.data.valid
    ? parseSchema(read.data.document)
    : { ok: false as const, errors: read.data.errors };
  if (!parsed.ok)
    throw new CliError(1, [
      `invalid schema ${shown}:`,
      ...parsed.errors.map((error) => `  ${error.path}: ${error.message}`),
    ]);
  const files = values.file?.length ? values.file : undefined;
  checkSchemaFiles(parsed.schema, files);
  return {
    name,
    remote: true,
    schema: parsed.schema,
    title: shown,
    ...(files ? { files } : {}),
    ci: Boolean(values.ci) || isCiEnv(io.env),
    json: Boolean(values.json),
    prompts: io.prompts ?? clackPrompts,
    connect: async () => connection,
  };
}

/** The project the selected environment names, its schema read. */
export function openProject(io: Io, values: GlobalValues): Promise<ProjectRun> {
  const name = selectedEnvironment(io, values);
  return name === LOCAL
    ? localRun(io, { ...values, env: LOCAL })
    : remoteRun(io, values, name);
}
