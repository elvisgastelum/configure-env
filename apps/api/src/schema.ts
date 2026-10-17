// The schema writes: every edit goes through the core's schema writer
// (src/writer in @configure-env/core), against the fingerprint the portal
// read, so an edit is validated as a whole, written atomically, and never
// made over a change it did not see. Each answer is the schema as it is
// then: the new one, or (with the errors, as JSON paths) the current one.
// A write is recorded in the history with the schema's text before and
// after, so it can be undone.

import { lstat, readFile } from 'node:fs/promises';
import {
  DEFAULT_EXAMPLE,
  STATE_IGNORE,
  type SchemaDocument,
  type SchemaEditResult,
  type SchemaWriteResult,
  VARIABLE_NAME,
  createSchemaFile,
  editSchemaFile,
  filePathProblem,
  ignoreState,
  inferSchema,
  recordHistory,
  resolveTarget,
  schemaChanges,
  writeSchemaFile,
} from '@configure-env/core';
import type { z } from 'zod';
import type { initSchemaRequest, schemaResponse } from './contracts.ts';
import { ApiError } from './http.ts';
import { type Project, readSchema } from './project.ts';

type SchemaView = z.output<typeof schemaResponse>;

/** The schema file as GET /api/schema shows it. */
export async function currentSchema(project: Project): Promise<SchemaView> {
  const read = await readSchema(project);
  const initFrom = read.fingerprint ? undefined : await initSource(project);
  return {
    path: project.schemaPath,
    valid: Boolean(read.schema),
    document: read.document,
    errors: read.errors,
    ...(read.fingerprint ? { fingerprint: read.fingerprint } : {}),
    ...(initFrom ? { initFrom } : {}),
  };
}

/**
 * While the schema file is missing: the example init would read, when it
 * exists and init may read it (inside the root, not a symlink).
 */
async function initSource(project: Project): Promise<string | undefined> {
  const missing = await lstat(project.schemaFile).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
  if (!missing) return undefined;
  const target = await resolveTarget(project.root, DEFAULT_EXAMPLE);
  return target.ok && target.exists ? DEFAULT_EXAMPLE : undefined;
}

/**
 * A write's outcome: the schema written, recorded in the history with the
 * change's id, or the error it answers with.
 */
async function answer(
  project: Project,
  result: SchemaWriteResult,
): Promise<SchemaView> {
  if (result.ok) {
    const history = await recordHistory(
      project.statePath,
      'portal',
      result.written
        ? schemaChanges(project.schemaPath, result.previous, result.file.text)
        : [],
    );
    return {
      path: project.schemaPath,
      valid: true,
      document: JSON.parse(result.file.text.replace(/^\uFEFF/, '')),
      errors: [],
      fingerprint: result.file.fingerprint,
      ...(history.ids.length ? { change: history.ids[0] } : {}),
      ...(history.warnings.length ? { warnings: history.warnings } : {}),
    };
  }
  const schema = await currentSchema(project);
  if (result.kind === 'stale')
    throw new ApiError(
      409,
      `${project.schemaPath} changed since it was read; reload it and make the edit again`,
      { schema },
    );
  if (result.kind === 'invalid')
    throw new ApiError(422, 'the edit was refused; nothing was written', {
      errors: result.errors,
      schema,
    });
  throw new ApiError(
    500,
    result.errors.map((error) => error.message).join('; '),
  );
}

/** Applies one writer edit to the schema file, against `fingerprint`. */
export async function editSchema(
  project: Project,
  fingerprint: string,
  edit: (document: SchemaDocument) => SchemaEditResult,
): Promise<SchemaView> {
  return answer(
    project,
    await editSchemaFile(project.schemaFile, fingerprint, edit),
  );
}

/** A variable name from the path, or a 400. */
export function variableName(name: string): string {
  if (!VARIABLE_NAME.test(name))
    throw new ApiError(400, `${name}: is not a valid variable name`);
  return name;
}

/** The source file's text, read inside the root; undefined for none. */
async function sourceText(
  project: Project,
  from: string | undefined,
): Promise<{ from?: string; text: string }> {
  const path = from ?? DEFAULT_EXAMPLE;
  if (filePathProblem(path))
    throw new ApiError(403, `${path}: must name a file inside the root`);
  const target = await resolveTarget(project.root, path);
  if (!target.ok) throw new ApiError(403, `${path}: ${target.message}`);
  if (!target.exists) {
    if (from === undefined) return { text: '' };
    throw new ApiError(404, `${path}: no such file`);
  }
  return { from: path, text: await readFile(target.absolute, 'utf8') };
}

/** ignoreState, answering what stopped it, if anything. */
async function ignoreStateInside(root: string): Promise<string | undefined> {
  try {
    return (await ignoreState(root)) === 'symlink'
      ? 'it is a symlink'
      : undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error);
  }
}

/**
 * Writes a starting schema inferred from an example env file: a new file, or
 * over the existing one when the request names its fingerprint. Once it is
 * written, the state directory is added to .gitignore, as `configure-env
 * init` does; a .gitignore it cannot update is a warning.
 */
export async function initSchema(
  project: Project,
  body: z.output<typeof initSchemaRequest>,
): Promise<SchemaView> {
  const source = await sourceText(project, body.from);
  const document = inferSchema(source.from, source.text);
  const result = body.fingerprint
    ? await writeSchemaFile(project.schemaFile, document, {
        fingerprint: body.fingerprint,
      })
    : await createSchemaFile(project.schemaFile, document);
  const view = await answer(project, result);
  const problem = await ignoreStateInside(project.root);
  if (problem)
    view.warnings = [
      ...(view.warnings ?? []),
      `cannot update .gitignore: ${problem}; add ${STATE_IGNORE} to it yourself`,
    ];
  return view;
}
