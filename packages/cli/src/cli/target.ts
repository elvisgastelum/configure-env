// What the variable commands (set, get, unset, list) share: which
// schema file they work on, and reading its keys through the API.

import {
  type ListedFile,
  type ListedKey,
  getVariables,
} from '@configure-env/api-client/client';
import { type EnvSchema, type FileSpec, isTemplate } from '@configure-env/core';
import { CliError, usageError } from './common.ts';
import { type Connection, type ProjectRun, answerOf, send } from './connect.ts';

/** The schema files a variable command may edit: those not a template. */
const editableFiles = (schema: EnvSchema) =>
  schema.files.filter((spec) => !isTemplate(spec));

/**
 * The file set, get and unset work on without --file: the only one that is
 * not a template; undefined when there are several, or none.
 */
export function defaultFile(schema: EnvSchema): FileSpec | undefined {
  const candidates = editableFiles(schema);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * The one file a set, get or unset works on: the --file path, else
 * {@link defaultFile}. A template needs `allowTemplate` when `guard` is set.
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
    file = defaultFile(schema);
    if (!file)
      throw usageError(
        editableFiles(schema).length
          ? 'the schema has more than one file; pass --file with one of:'
          : 'the schema has no file but templates; pass --file with one of:',
        ...schema.files.map((spec) => `  ${spec.path}`),
      );
  }
  if (!file) throw usageError('the schema lists no file');
  if (guard && isTemplate(file) && !allowTemplate)
    throw usageError(
      `${file.path} is a template, committed with placeholders`,
      'pass --allow-template to edit it anyway',
    );
  return file;
}

export { UNKNOWN_SPEC, variablesOf } from '@configure-env/core';
export type { ListedFile, ListedKey };

/** Every schema file with its keys as the server reads them now: GET /api/variables. */
export async function listFiles(
  run: ProjectRun,
  connection: Connection,
): Promise<ListedFile[]> {
  const response = await send(connection, () =>
    getVariables(connection.init()),
  );
  return answerOf<{ files?: ListedFile[] }>(run, response).files ?? [];
}

/** One schema file of the listing; a path that is not safe to use exits 1. */
export function listedFile(
  files: readonly ListedFile[],
  spec: FileSpec,
): ListedFile {
  const file = files.find((entry) => entry.path === spec.path);
  if (!file) throw new CliError(1, [`${spec.path}: is not in the schema`]);
  if (file.error !== undefined) throw new CliError(1, [file.error]);
  return file;
}

/** A key of a listed file; undefined when the file neither lists nor holds it. */
export const listedKey = (
  file: ListedFile,
  key: string,
): ListedKey | undefined => file.keys.find((entry) => entry.key === key);
