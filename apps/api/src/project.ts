// The project the server is bound to: its real root and its schema file,
// which must lie inside that root.

import { readFile, realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  type EnvSchema,
  type SchemaError,
  parseSchemaText,
  resolveTarget,
} from '@configure-env/core';

export interface Project {
  /** The real path of the project root. */
  root: string;
  /** The schema file, absolute. */
  schemaFile: string;
  /** The schema file relative to the root, with `/` separators. */
  schemaPath: string;
}

/** Resolves the root and the schema; throws when the schema leaves the root. */
export async function resolveProject(
  root: string,
  schemaPath: string,
): Promise<Project> {
  const real = await realpath(root);
  const target = await resolveTarget(real, schemaPath);
  if (!target.ok)
    throw new Error(
      `the schema must be a regular file inside the root: ${schemaPath} ${target.message}`,
    );
  return {
    root: real,
    schemaFile: target.absolute,
    schemaPath: relative(real, target.absolute).split('\\').join('/'),
  };
}

/** The schema file as it is on disk now, valid or not. */
export interface SchemaRead {
  /** The parsed JSON; null when the file cannot be read or parsed. */
  document: unknown;
  schema?: EnvSchema;
  errors: SchemaError[];
}

/** Reads the schema afresh: the files may change while the server runs. */
export async function readSchema(project: Project): Promise<SchemaRead> {
  let text: string;
  try {
    text = await readFile(project.schemaFile, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return {
      document: null,
      errors: [
        {
          path: '(root)',
          message: `cannot read ${project.schemaPath}: ${code}`,
        },
      ],
    };
  }
  const result = parseSchemaText(text);
  let document: unknown = null;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // parseSchemaText reports the syntax error with its position.
  }
  return result.ok
    ? { document, schema: result.schema, errors: [] }
    : { document, errors: result.errors };
}
