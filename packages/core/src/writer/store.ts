// Reads `env.schema.json` with a fingerprint of its bytes, and writes an
// edited document back atomically: the text goes to a temporary file in the
// same directory, is flushed, and then takes the file's place, so a reader
// never sees half a schema. A write names the fingerprint its edit started
// from, and a file that changed since then is not written (optimistic
// concurrency). The text is formatted over the current file, so an edit
// changes only the bytes it must.

import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { EnvSchema } from '../schema/definition.ts';
import { type SchemaError, parseSchemaText } from '../schema/load.ts';
import {
  type SchemaDocument,
  type SchemaEditResult,
  validateDocument,
} from './document.ts';
import { formatJson } from './format.ts';

/** The schema file as it was read. */
export interface SchemaFile {
  text: string;
  /** Identifies `text`; a write expects it to still be on disk. */
  fingerprint: string;
  /** The JSON as written, without the defaults parsing fills in. */
  document: SchemaDocument;
  schema: EnvSchema;
}

export type SchemaReadResult =
  | { ok: true; file: SchemaFile }
  | { ok: false; errors: SchemaError[]; fingerprint?: string };

/**
 * Why a write wrote nothing: the file changed since the edit read it
 * (`stale`), the document is not a valid schema (`invalid`), or the file
 * could not be read or written (`io`).
 */
export type SchemaWriteFailure = {
  ok: false;
  kind: 'stale' | 'invalid' | 'io';
  errors: SchemaError[];
};

export type SchemaWriteResult =
  { ok: true; file: SchemaFile; written: boolean } | SchemaWriteFailure;

/** The fingerprint of schema text: `sha256:` and its hex digest. */
export function schemaFingerprint(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

const ioError = (path: string, verb: string, error: unknown) =>
  `cannot ${verb} ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`;

const failure = (
  kind: SchemaWriteFailure['kind'],
  message: string,
): SchemaWriteFailure => ({
  ok: false,
  kind,
  errors: [{ path: '(root)', message }],
});

const stale = (path: string) =>
  failure(
    'stale',
    `${path} changed since it was read; reload it and make the edit again`,
  );

/** Reads, parses and validates the schema file, with its fingerprint. */
export async function readSchemaFile(path: string): Promise<SchemaReadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: '(root)', message: ioError(path, 'read', error) }],
    };
  }
  const fingerprint = schemaFingerprint(text);
  const parsed = parseSchemaText(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, fingerprint };
  const document = JSON.parse(
    text.startsWith('﻿') ? text.slice(1) : text,
  ) as SchemaDocument;
  return {
    ok: true,
    file: { text, fingerprint, document, schema: parsed.schema },
  };
}

/** Flushes a directory entry change; not every platform allows it. */
async function syncDirectory(dir: string) {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Best effort.
  }
}

/** Writes `text` over `target` through a temporary file, keeping `mode`. */
async function replaceAtomically(
  target: string,
  text: string,
  mode: number,
  expected: string,
): Promise<boolean> {
  const dir = dirname(target);
  const temp = join(
    dir,
    `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let created = false;
  try {
    const handle = await open(temp, 'wx', mode);
    created = true;
    try {
      await handle.writeFile(text, 'utf8');
      // The mode given to open is subject to the umask; chmod is not.
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // The last check before the swap: an edit made meanwhile is kept.
    if (schemaFingerprint(await readFile(target, 'utf8')) !== expected)
      return false;
    await rename(temp, target);
    created = false;
    await syncDirectory(dir);
    return true;
  } finally {
    if (created) await rm(temp, { force: true }).catch(() => undefined);
  }
}

/**
 * Writes `document` to the schema file at `path`, when the file still has
 * the fingerprint the edit started from. The document is validated first,
 * and a document that formats to the current text is not written. A symlink
 * is written through, to its target.
 */
export async function writeSchemaFile(
  path: string,
  document: SchemaDocument,
  expected: { fingerprint: string },
): Promise<SchemaWriteResult> {
  const valid = validateDocument(document);
  if (!valid.ok) return { ok: false, kind: 'invalid', errors: valid.errors };
  let target: string, current: string, mode: number;
  try {
    target = await realpath(path);
    current = await readFile(target, 'utf8');
    mode = (await stat(target)).mode & 0o777;
  } catch (error) {
    return failure('io', ioError(path, 'read', error));
  }
  if (schemaFingerprint(current) !== expected.fingerprint) return stale(path);
  const text = formatJson(document, current);
  const file = (written: boolean): SchemaWriteResult => ({
    ok: true,
    written,
    file: {
      text,
      fingerprint: schemaFingerprint(text),
      document: valid.document,
      schema: valid.schema,
    },
  });
  if (text === current) return file(false);
  try {
    if (!(await replaceAtomically(target, text, mode, expected.fingerprint)))
      return stale(path);
  } catch (error) {
    return failure('io', ioError(path, 'write', error));
  }
  return file(true);
}

/**
 * Reads the schema file, applies `edit` to its document and writes the
 * result, all against `fingerprint`: the fingerprint the caller last saw, so
 * an edit made from an outdated view is refused before it runs.
 */
export async function editSchemaFile(
  path: string,
  fingerprint: string,
  edit: (document: SchemaDocument) => SchemaEditResult,
): Promise<SchemaWriteResult> {
  const read = await readSchemaFile(path);
  if (!read.ok) {
    if (read.fingerprint !== undefined && read.fingerprint !== fingerprint)
      return stale(path);
    return {
      ok: false,
      kind: read.fingerprint ? 'invalid' : 'io',
      errors: read.errors,
    };
  }
  if (read.file.fingerprint !== fingerprint) return stale(path);
  const edited = edit(read.file.document);
  if (!edited.ok) return { ok: false, kind: 'invalid', errors: edited.errors };
  return writeSchemaFile(path, edited.document, { fingerprint });
}
