// The CLI's runs over the built-in portfolio schema
// (examples/portfolio.env.schema.json), until the CLI reads a project's own
// env.schema.json: which files a run plans, and how results read.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvSchema } from './schema/definition.ts';
import { parseSchemaText } from './schema/load.ts';
import type { ApplyResult } from './engine/apply.ts';
import type { FileDrift } from './engine/check.ts';
import { type FilePlan, type Plan, planChanges } from './engine/plan.ts';

export const BUILTIN_SCHEMA_PATH = fileURLToPath(
  new URL('../examples/portfolio.env.schema.json', import.meta.url),
);

export const PRODUCTION_EXAMPLE_PATH = 'deploy/.env.production.example';
export const EXAMPLE_PATH = '.env.example';
export const LOCAL_PATH = '.env';

/** Reads and validates the built-in schema; a broken one is a bug. */
export function loadBuiltinSchema(): EnvSchema {
  const result = parseSchemaText(readFileSync(BUILTIN_SCHEMA_PATH, 'utf8'));
  if (!result.ok)
    throw new Error(
      `invalid built-in schema: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  return result.schema;
}

/** The files a person keeps locally (create-only), never committed. */
export const localPaths = (schema: EnvSchema): string[] =>
  schema.files
    .filter((file) => file.policy === 'create-only')
    .map((file) => file.path);

/** The committed example files: every file that is not create-only. */
export const examplePaths = (schema: EnvSchema): string[] =>
  schema.files
    .filter((file) => file.policy !== 'create-only')
    .map((file) => file.path);

/**
 * Plans `paths`. The given values go only into the local (create-only)
 * files; the examples always hold the schema's defaults and placeholders.
 */
export async function planRun({
  schema,
  root,
  paths,
  values,
}: {
  schema: EnvSchema;
  root: string;
  paths: readonly string[];
  values: Readonly<Record<string, string>>;
}): Promise<Plan> {
  const local = localPaths(schema);
  const examples = paths.filter((path) => !local.includes(path));
  const locals = paths.filter((path) => local.includes(path));
  const parts = await Promise.all([
    planChanges({ schema, root, values: {}, files: examples }),
    ...(locals.length
      ? [planChanges({ schema, root, values, files: locals })]
      : []),
  ]);
  return {
    root: parts[0]!.root,
    files: parts.flatMap((part) => part.files),
    errors: parts.flatMap((part) => part.errors),
  };
}

/** One output line: `path: created`, `path: added keys: A B`, ... */
export function describeFile(file: FilePlan): string {
  const status = {
    create: 'created',
    update:
      file.policy === 'merge'
        ? `added keys: ${file.addedKeys.join(' ')}`
        : 'updated',
    unchanged: 'unchanged',
    skip:
      file.reason === 'exists'
        ? 'unchanged (exists; never overwritten)'
        : `refused (${file.error})`,
  }[file.action];
  return `${file.path}: ${status}`;
}

/** A failed write, for stderr. */
export const describeFailure = (result: ApplyResult) =>
  `${result.path}: not written: ${result.error}`;

/** For `--check`: the file's state, then one line per invalid value. */
export function describeDrift(file: FileDrift): string[] {
  const status = {
    current: 'current',
    missing: 'missing',
    differs: 'differs from the schema',
    'missing-keys': `missing keys: ${file.missingKeys.join(' ')}`,
    refused: `refused (${file.error})`,
  }[file.status];
  return [
    `${file.path}: ${status}`,
    ...file.invalid.map(
      ({ key, message }) => `${file.path}: invalid ${key}: ${message}`,
    ),
  ];
}
