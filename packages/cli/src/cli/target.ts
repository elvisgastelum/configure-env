// What the variable commands (set, get, unset, list) share: which
// schema file they work on, and reading it.

import {
  type EnvFile,
  type EnvSchema,
  type FileSpec,
  type VariableSpec,
  isTemplate,
  maskValue,
  readEnvFile as readCoreFile,
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

export { type EnvFile, UNKNOWN_SPEC, variablesOf } from '@configure-env/core';

/** Reads a schema file; a path that is not safe to use exits 1. */
export async function readEnvFile(
  context: Context,
  spec: FileSpec,
): Promise<EnvFile> {
  const result = await readCoreFile(context.root, spec);
  if (!result.ok) throw new CliError(1, [result.message]);
  return result.file;
}

/** `value` or `masked` for JSON output, by whether the variable is secret. */
export const jsonValue = (spec: VariableSpec, value: string) =>
  spec.secret ? { masked: maskValue(spec, value) } : { value };
