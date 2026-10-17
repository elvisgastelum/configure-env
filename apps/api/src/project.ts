// The project the server is bound to: its real root and its schema file,
// which must lie inside that root.

import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  DEFAULT_STATE_PATH,
  type EnvSchema,
  type SchemaError,
  type StateWriter,
  parseSchemaText,
  resolveTarget,
  schemaFingerprint,
} from '@configure-env/core';

export interface Project {
  /** The real path of the project root. */
  root: string;
  /** The schema file, absolute. */
  schemaFile: string;
  /** The schema file relative to the root, with `/` separators. */
  schemaPath: string;
  /** The state database: protected values and the history of edits. */
  statePath: string;
  /**
   * The state relative to the root as it was given, for the git-ignore
   * check, when a statePath was given: through a symlinked root, the real
   * root and the given path no longer share a prefix.
   */
  stateInRoot?: string;
  /** What a value write's messages show paths relative to; the root when absent. */
  cwd?: string;
  /** Writes the protected variables' state, for the CLI's tests. */
  writeState?: StateWriter;
}

export interface ProjectOptions {
  /** The state database, relative to the root as given or absolute; used as is. */
  statePath?: string;
  /** Read the schema wherever schemaPath leads, outside the root or a symlink. */
  schemaAnywhere?: boolean;
}

/** Resolves the root and the schema; throws when the schema leaves the root. */
export async function resolveProject(
  root: string,
  schemaPath: string,
  { statePath, schemaAnywhere = false }: ProjectOptions = {},
): Promise<Project> {
  const real = await realpath(root);
  let schemaFile: string;
  if (schemaAnywhere) schemaFile = resolve(root, schemaPath);
  else {
    const target = await resolveTarget(real, schemaPath);
    if (!target.ok)
      throw new Error(
        `the schema must be a regular file inside the root: ${schemaPath} ${target.message}`,
      );
    schemaFile = target.absolute;
  }
  const state = statePath === undefined ? undefined : resolve(root, statePath);
  return {
    root: real,
    schemaFile,
    // A schema read anywhere is named from the root as it was given, as
    // the CLI names it: through a symlinked root, the real one shares no
    // prefix with it.
    schemaPath: relative(schemaAnywhere ? resolve(root) : real, schemaFile)
      .split('\\')
      .join('/'),
    statePath: state ?? resolve(real, DEFAULT_STATE_PATH),
    ...(state ? { stateInRoot: relative(resolve(root), state) } : {}),
  };
}

/** The schema file as it is on disk now, valid or not. */
export interface SchemaRead {
  /** The parsed JSON; null when the file cannot be read or parsed. */
  document: unknown;
  schema?: EnvSchema;
  errors: SchemaError[];
  /** Identifies the bytes read; absent when the file cannot be read. */
  fingerprint?: string;
  /** The bytes read, as text; absent when the file cannot be read. */
  text?: string;
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
  const fingerprint = schemaFingerprint(text);
  return result.ok
    ? { document, schema: result.schema, errors: [], fingerprint, text }
    : { document, errors: result.errors, fingerprint, text };
}
