// The schema writes: every edit goes through the core's schema writer
// (src/writer in @configure-env/core), against the fingerprint the portal
// read, so an edit is validated as a whole, written atomically, and never
// made over a change it did not see. Each answer is the schema as it is
// then: the new one, or (with the errors, as JSON paths) the current one.
// A write is recorded in the history with the schema's text before and
// after, so it can be undone.

import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DEFAULT_EXAMPLE,
  type EnvSchema,
  type IgnoreStatus,
  STATE_IGNORE,
  type SchemaDocument,
  type SchemaEditResult,
  type SchemaWriteResult,
  VARIABLE_NAME,
  createSchemaFile,
  editSchemaFile,
  filePathProblem,
  getValue,
  ignoreState,
  inferSchema,
  keysOf,
  parseDotenv,
  parseSchemaText,
  recordHistory,
  resolveTarget,
  restoreSchemaFile,
  schemaChanges,
  schemaFingerprint,
  validateDocument,
  writeSchemaFile,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  initSchemaRequest,
  replaceSchemaRequest,
  schemaResponse,
} from './contracts.ts';
import { ApiError } from './http.ts';
import { type Project, readSchema } from './project.ts';

type SchemaView = z.output<typeof schemaResponse>;

/** Who a write is recorded as in the history: `cli` or `portal`. */
export type Actor = 'cli' | 'portal';

/**
 * The schema file as GET /api/schema shows it; with `text`, the file's
 * text too, when it can be read.
 */
export async function currentSchema(
  project: Project,
  { text = false }: { text?: boolean } = {},
): Promise<SchemaView> {
  const read = await readSchema(project);
  const initFrom = read.fingerprint ? undefined : await initSource(project);
  return {
    path: project.schemaPath,
    valid: Boolean(read.schema),
    document: read.document,
    errors: read.errors,
    ...(read.fingerprint ? { fingerprint: read.fingerprint } : {}),
    ...(initFrom ? { initFrom } : {}),
    ...(text && read.text !== undefined ? { text: read.text } : {}),
  };
}

/**
 * While the schema file is missing: the example init reads, when something
 * is there. One init refuses (a symlink) is named too, so the portal offers
 * it and init's refusal says why, rather than claiming there is none.
 */
async function initSource(project: Project): Promise<string | undefined> {
  const exists = (path: string) =>
    lstat(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => error.code !== 'ENOENT',
    );
  if (await exists(project.schemaFile)) return undefined;
  return (await exists(join(project.root, DEFAULT_EXAMPLE)))
    ? DEFAULT_EXAMPLE
    : undefined;
}

/**
 * A write's outcome: the schema written, recorded in the history with the
 * change's id, or the error it answers with.
 */
async function answer(
  project: Project,
  result: SchemaWriteResult,
  actor: Actor = 'portal',
): Promise<SchemaView> {
  if (result.ok) {
    const history = await recordHistory(
      project.statePath,
      actor,
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

/** ignoreState, or what stopped it. */
async function ignoreStateInside(
  root: string,
): Promise<{ status: IgnoreStatus } | { problem: string }> {
  try {
    return { status: await ignoreState(root) };
  } catch (error) {
    return { problem: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
}

/** Whether something is at `path`, a symlink or a file it cannot read too. */
const occupied = (path: string) =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== 'ENOENT',
  );

/** The text configure-env init writes a starting schema as. */
const initText = (document: SchemaDocument) =>
  `${JSON.stringify(document, null, 2)}\n`;

/**
 * Writes a starting schema inferred from an example env file: a new file, or
 * over the existing one when the request names its fingerprint, byte for
 * byte as `configure-env init` writes it. The variables given replace the
 * inferred ones; a preview answers the schema and writes nothing. Once it is
 * written, the state directory is added to .gitignore, as `configure-env
 * init` does; a .gitignore it cannot update is a warning.
 */
export async function initSchema(
  project: Project,
  body: z.output<typeof initSchemaRequest>,
  actor: Actor = 'portal',
): Promise<SchemaView> {
  // A schema there is refused first, before the source is read, as
  // configure-env init refuses it.
  if (!body.fingerprint && (await occupied(project.schemaFile)))
    return answer(project, {
      ok: false,
      kind: 'stale',
      errors: [{ path: '(root)', message: `${project.schemaPath} exists` }],
    });
  const source = await sourceText(project, body.from);
  const document = inferSchema(source.from, source.text);
  if (body.variables)
    document.variables = body.variables as SchemaDocument['variables'];
  if (body.preview) {
    const valid = validateDocument(document);
    if (!valid.ok)
      throw new ApiError(422, 'the inferred schema is invalid', {
        errors: valid.errors,
        schema: await currentSchema(project),
      });
    return {
      path: project.schemaPath,
      valid: true,
      document,
      errors: [],
    };
  }
  const result = body.fingerprint
    ? await restoreSchemaFile(project.schemaFile, initText(document), {
        fingerprint: body.fingerprint,
      })
    : await createSchemaFile(project.schemaFile, document);
  const view = await answer(project, result, actor);
  const ignored = await ignoreStateInside(project.root);
  const problem =
    'problem' in ignored
      ? ignored.problem
      : ignored.status === 'symlink'
        ? 'it is a symlink'
        : undefined;
  if ('status' in ignored) view.gitignore = ignored.status;
  if (problem)
    view.warnings = [
      ...(view.warnings ?? []),
      `cannot update .gitignore: ${problem}; add ${STATE_IGNORE} to it yourself`,
    ];
  return view;
}

/**
 * Replaces the whole schema with `document`, against its fingerprint. With
 * keepSecretsMasked, a document that would show a hidden value is refused
 * (403) before anything is written: see {@link unmaskedKeys}.
 */
export async function replaceSchema(
  project: Project,
  body: z.output<typeof replaceSchemaRequest>,
  actor: Actor = 'portal',
): Promise<SchemaView> {
  if (body.keepSecretsMasked) {
    const keys = await unmaskedKeys(project, body.fingerprint, body.document);
    if (keys.length)
      throw new ApiError(
        403,
        `the edit would unmask ${keys.join(', ')}; nothing was written`,
        { keys },
      );
  }
  return answer(
    project,
    await writeSchemaFile(project.schemaFile, body.document as SchemaDocument, {
      fingerprint: body.fingerprint,
    }),
    actor,
  );
}

/** Whether the schema declares `name` with `secret: true`. */
const isSecret = (schema: EnvSchema, name: string) =>
  Object.hasOwn(schema.variables, name) &&
  schema.variables[name]!.secret === true;

/**
 * Whether a key's value stays out of every answer: a secret variable, or a
 * key the schema does not declare, whose sensitivity nobody stated.
 */
const isHidden = (schema: EnvSchema, name: string) =>
  !Object.hasOwn(schema.variables, name) || isSecret(schema, name);

/**
 * The keys the schema at `fingerprint` keeps hidden that `document` would
 * show: a secret variable removed or no longer `secret: true`, or a key a
 * schema file (of either schema) already holds a value for, newly declared
 * without `secret: true` or held in a file the schema newly lists. A schema
 * changed since the fingerprint, or an invalid document, answers none; the
 * write then refuses it.
 */
async function unmaskedKeys(
  project: Project,
  fingerprint: string,
  document: Record<string, unknown>,
): Promise<string[]> {
  const text = await readFile(project.schemaFile, 'utf8').catch(
    () => undefined,
  );
  if (text === undefined || schemaFingerprint(text) !== fingerprint) return [];
  const next = validateDocument(document as SchemaDocument);
  if (!next.ok) return [];
  // An invalid current schema hides everything: it masks nothing it can read.
  const parsed = parseSchemaText(text);
  const current: EnvSchema = parsed.ok
    ? parsed.schema
    : { ...next.schema, variables: {}, files: [] };
  const unmasked = new Set(
    Object.keys(current.variables).filter(
      (name) => isSecret(current, name) && !isSecret(next.schema, name),
    ),
  );
  // A file the current schema does not list is never read, so every value
  // it holds is hidden until now.
  const read = new Set(current.files.map((file) => file.path));
  const paths = new Set(
    [...current.files, ...next.schema.files].map((file) => file.path),
  );
  for (const path of paths) {
    const held = await readFile(resolve(project.root, path), 'utf8').catch(
      () => undefined,
    );
    if (held === undefined) continue;
    const doc = parseDotenv(held);
    for (const name of keysOf(doc))
      if (
        getValue(doc, name) &&
        (!read.has(path) || isHidden(current, name)) &&
        !isHidden(next.schema, name)
      )
        unmasked.add(name);
  }
  return [...unmasked].sort();
}
