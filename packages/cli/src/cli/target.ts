// What the variable commands (set, get, unset, list, validate) share: which
// schema file they work on, reading it, and writing it back atomically.

import { readFile, realpath } from 'node:fs/promises';
import {
  type DotenvDocument,
  type EnvSchema,
  type FilePlan,
  type FileSpec,
  type VariableSpec,
  applyPlan,
  fileKeys,
  isTemplate,
  maskValue,
  parseDotenv,
  resolveTarget,
} from '@configure-env/core';
import { CliError, type Context, usageError } from './common.ts';

/**
 * The one file a set, get or unset works on: the --file path, else the only
 * non-template file. A template needs `allowTemplate` when `guard` is set.
 */
export function chooseFile(
  schema: EnvSchema,
  files: readonly string[] | undefined,
  { guard = false, allowTemplate = false } = {},
): FileSpec {
  if (files && files.length > 1)
    throw usageError('--file takes one path for this command');
  let file: FileSpec | undefined;
  if (files?.length) {
    file = schema.files.find((spec) => spec.path === files[0]);
  } else {
    const candidates = schema.files.filter((spec) => !isTemplate(spec));
    if (candidates.length !== 1)
      throw usageError(
        candidates.length
          ? 'the schema has more than one file; pass --file with one of:'
          : 'the schema has no file but templates; pass --file with one of:',
        ...schema.files.map((spec) => `  ${spec.path}`),
      );
    file = candidates[0];
  }
  if (!file) throw usageError('the schema lists no file');
  if (guard && isTemplate(file) && !allowTemplate)
    throw usageError(
      `${file.path} is a template, committed with placeholders`,
      'pass --allow-template to edit it anyway',
    );
  return file;
}

/** A schema file as it is on disk now. */
export interface EnvFile {
  spec: FileSpec;
  /** The real project root. */
  root: string;
  absolute: string;
  exists: boolean;
  /** The current permissions; absent when the file does not exist. */
  mode?: number;
  /** The current content; absent when the file does not exist. */
  previous?: string;
  /** The parsed content; empty when the file does not exist. */
  doc: DotenvDocument;
}

/** Reads a schema file; a path that is not safe to use exits 1. */
export async function readEnvFile(
  context: Context,
  spec: FileSpec,
): Promise<EnvFile> {
  const root = await realpath(context.root);
  const target = await resolveTarget(root, spec.path);
  if (!target.ok) throw new CliError(1, [`${spec.path}: ${target.message}`]);
  const previous = target.exists
    ? await readFile(target.absolute, 'utf8')
    : undefined;
  return {
    spec,
    root,
    absolute: target.absolute,
    exists: target.exists,
    ...(target.mode === undefined ? {} : { mode: target.mode }),
    ...(previous === undefined ? {} : { previous }),
    doc: parseDotenv(previous ?? ''),
  };
}

/**
 * Writes `content` atomically: an existing file keeps its mode, a new one
 * takes the schema's (else 644). A failed write exits 1.
 */
export async function writeEnvFile(file: EnvFile, content: string) {
  const { spec } = file;
  const schemaMode = spec.mode ? Number.parseInt(spec.mode, 8) : undefined;
  const plan: FilePlan = {
    path: spec.path,
    policy: spec.policy,
    action: file.exists ? 'update' : 'create',
    addedKeys: [],
    mode: file.mode ?? schemaMode ?? 0o644,
    content,
    target: file.absolute,
    ...(file.previous === undefined ? {} : { previous: file.previous }),
  };
  const [result] = await applyPlan({
    root: file.root,
    files: [plan],
    errors: [],
  });
  if (!result?.ok)
    throw new CliError(1, [`${spec.path}: not written: ${result?.error}`]);
}

/** A key that is not one of the file's variables: a plain string. */
export const UNKNOWN_SPEC: VariableSpec = {
  type: 'string',
  required: false,
  secret: false,
};

/** The file's variables in output order. */
export const variablesOf = (schema: EnvSchema, file: FileSpec) =>
  new Set(fileKeys(schema, file));

/** `value` or `masked` for JSON output, by whether the variable is secret. */
export const jsonValue = (spec: VariableSpec, value: string) =>
  spec.secret ? { masked: maskValue(spec, value) } : { value };
