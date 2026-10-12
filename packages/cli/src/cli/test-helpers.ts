// Shared by the CLI tests: a temporary project root with a schema, and a
// `main` runner with an injected io and a scripted prompts adapter.

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach } from 'vitest';
import {
  DEFAULT_STATE_PATH,
  type State,
  emptyState,
  loadState,
  writeState,
} from '@configure-env/core';
import type { Io, Prompts } from './io.ts';
import { main } from './main.ts';

/** The repository root: README.md, the workspace and release config. */
export const REPO_ROOT = new URL('../../../../', import.meta.url);

/** The state database, relative to a project root. */
export const STATE = DEFAULT_STATE_PATH;

/** The state.json of earlier versions, relative to a project root. */
export const LEGACY_STATE = '.configure-env/state.json';

/** The state at `path`, failing the test when it cannot be read. */
export async function readState(path: string): Promise<State> {
  const result = await loadState(path);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

/**
 * Everything the state's directory holds, the database and its WAL
 * included, as text: for checking that no value was written there.
 */
export async function stateBytes(path: string): Promise<string> {
  const dir = dirname(path);
  const names = await readdir(dir).catch(() => []);
  const texts = await Promise.all(
    names.map((name) => readFile(join(dir, name), 'latin1')),
  );
  return texts.join('\n');
}

/**
 * Holds the state database's write transaction from another connection, as
 * another run would, creating the database when missing. Returns the
 * release.
 */
export async function holdState(path: string): Promise<() => void> {
  const current = await loadState(path);
  if (!current.ok || !current.exists) await writeState(path, emptyState());
  const db = new Database(path, { fileMustExist: true });
  db.exec('BEGIN IMMEDIATE');
  return () => {
    db.exec('COMMIT');
    db.close();
  };
}

/** One file per policy over five variables; no file name starts with `.env`. */
export const CLI_SCHEMA = {
  version: 1,
  variables: {
    HOST: {
      type: 'host',
      group: 'Server',
      description: 'Address to listen on',
      required: true,
      default: '127.0.0.1',
    },
    PORT: { type: 'port', group: 'Server', default: 8080 },
    TOKEN: {
      type: 'string',
      group: 'Auth',
      description: 'API token',
      secret: true,
      required: true,
      minLength: 8,
    },
    MODE: { type: 'enum', values: ['dev', 'prod'], default: 'dev' },
    DEBUG: { type: 'boolean', default: false },
  },
  files: [
    {
      path: 'config/app.env',
      policy: 'generate',
      variables: '*',
      values: { TOKEN: '<token>' },
    },
    {
      path: 'shared.env',
      policy: 'merge',
      variables: ['HOST', 'PORT', 'MODE', 'DEBUG'],
    },
    { path: 'local.env', policy: 'create-only', mode: '600', variables: '*' },
  ],
};

/**
 * secret-manager's rules: a base64 master key or a file holding it, never
 * both, and a previous key, or its file, that must differ from the current one.
 */
export const RULES_SCHEMA = {
  version: 1,
  variables: {
    SM_MASTER_KEY: {
      type: 'string',
      secret: true,
      encoding: 'base64',
      bytes: 32,
      requiredUnless: 'SM_MASTER_KEY_FILE',
      conflictsWith: 'SM_MASTER_KEY_FILE',
    },
    SM_MASTER_KEY_FILE: { type: 'string' },
    SM_PREVIOUS_MASTER_KEY: {
      type: 'string',
      secret: true,
      encoding: 'base64',
      bytes: 32,
      conflictsWith: 'SM_PREVIOUS_MASTER_KEY_FILE',
      distinctFrom: 'SM_MASTER_KEY',
    },
    SM_PREVIOUS_MASTER_KEY_FILE: { type: 'string' },
  },
  files: [
    { path: '.env.example', policy: 'merge', variables: '*' },
    { path: '.env', policy: 'create-only', mode: '600', variables: '*' },
  ],
};

/** Two base64 keys of 32 bytes. */
export const KEY_A = Buffer.alloc(32, 0xfb).toString('base64');
export const KEY_B = Buffer.alloc(32, 0x0a).toString('base64');

/** A fresh temporary root per test, holding `env.schema.json` unless `schema` is null. */
export function useProject(schema: unknown = CLI_SCHEMA) {
  const dirs = { root: '' };
  beforeEach(async () => {
    dirs.root = await mkdtemp(join(tmpdir(), 'configure-env-cli-'));
    if (schema !== null)
      await writeFile(
        join(dirs.root, 'env.schema.json'),
        JSON.stringify(schema, null, 2),
      );
  });
  afterEach(async () => {
    await rm(dirs.root, { recursive: true, force: true });
  });
  return dirs;
}

export interface PromptCall {
  kind: string;
  message: string;
  options?: unknown;
}

const CANCEL = Symbol('cancel');

/**
 * Prompts that answer from `answers` by message (or by variable name in the
 * message); otherwise with the prompt's initial value, and `true` for a
 * confirm. An answer of `'cancel'` cancels.
 */
export function scriptedPrompts(answers: Record<string, unknown> = {}) {
  const calls: PromptCall[] = [];
  const logs: string[] = [];
  const answerFor = (message: string, fallback: unknown) => {
    const key = Object.keys(answers).find((k) => message.includes(k));
    const answer = key === undefined ? fallback : answers[key];
    return answer === 'cancel' ? CANCEL : answer;
  };
  const record = (kind: string) => (message?: string, title?: string) => {
    logs.push(`${kind}: ${title ? `${title}: ` : ''}${message ?? ''}`);
  };
  const prompts: Prompts = {
    intro: record('intro'),
    outro: record('outro'),
    cancel: record('cancel'),
    note: record('note'),
    log: {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      step: record('step'),
      success: record('success'),
    },
    isCancel: (value): value is symbol => value === CANCEL,
    async multiselect(opts) {
      calls.push({ kind: 'multiselect', ...opts });
      return answerFor(opts.message, opts.initialValues ?? []) as never;
    },
    async select(opts) {
      calls.push({ kind: 'select', ...opts });
      return answerFor(opts.message, opts.initialValue) as never;
    },
    async text(opts) {
      calls.push({ kind: 'text', ...opts });
      const answer = answerFor(opts.message, opts.initialValue ?? '');
      if (typeof answer === 'string') {
        const error = opts.validate?.(answer);
        if (error) throw new Error(`invalid answer: ${String(error)}`);
      }
      return answer as never;
    },
    async password(opts) {
      calls.push({ kind: 'password', ...opts });
      const answer = answerFor(opts.message, '');
      if (typeof answer === 'string') {
        const error = opts.validate?.(answer);
        if (error) throw new Error(`invalid answer: ${String(error)}`);
      }
      return answer as never;
    },
    async confirm(opts) {
      calls.push({ kind: 'confirm', ...opts });
      return answerFor(opts.message, true) as never;
    },
    spinner: () => ({
      start: record('spinner'),
      stop: record('spinner'),
      error: record('spinner-error'),
    }),
  };
  return { prompts, calls, logs };
}

export interface Run {
  code: number;
  out: string[];
  err: string[];
}

export async function run(
  argv: string[],
  {
    cwd,
    env = {},
    isTTY = false,
    prompts,
    stdin,
    // A test without stdin runs in one terminal, stdin included; given stdin is a pipe.
    stdinIsTTY = stdin === undefined ? isTTY : false,
    writeState,
  }: {
    cwd: string;
    env?: Io['env'];
    isTTY?: boolean;
    prompts?: Prompts;
    /**
     * What stdin holds, the error its reader rejects with, or the reader
     * itself; no stdin reader when absent.
     */
    stdin?: string | Error | (() => Promise<string>);
    stdinIsTTY?: boolean;
    /** Writes the protected variables' state; a failing one in tests. */
    writeState?: Io['writeState'];
  },
): Promise<Run> {
  const result: Run = { code: -1, out: [], err: [] };
  result.code = await main(argv, {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env,
    isTTY,
    cwd,
    prompts,
    stdinIsTTY,
    ...(writeState ? { writeState } : {}),
    ...(stdin === undefined
      ? {}
      : {
          readStdin: async () => {
            if (stdin instanceof Error) throw stdin;
            return typeof stdin === 'function' ? stdin() : stdin;
          },
        }),
  });
  return result;
}
