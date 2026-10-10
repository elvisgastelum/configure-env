// Shared by the CLI tests: a temporary project root with a schema, and a
// `main` runner with an injected io and a scripted prompts adapter.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { Io, Prompts } from './io.ts';
import { main } from './main.ts';

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

/** A fresh temporary root per test, holding `env.schema.json`. */
export function useProject(schema: unknown = CLI_SCHEMA) {
  const dirs = { root: '' };
  beforeEach(async () => {
    dirs.root = await mkdtemp(join(tmpdir(), 'configure-env-cli-'));
    if (schema !== undefined)
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
  }: { cwd: string; env?: Io['env']; isTTY?: boolean; prompts?: Prompts },
): Promise<Run> {
  const result: Run = { code: -1, out: [], err: [] };
  result.code = await main(argv, {
    stdout: (line) => result.out.push(line),
    stderr: (line) => result.err.push(line),
    env,
    isTTY,
    cwd,
    prompts,
  });
  return result;
}
