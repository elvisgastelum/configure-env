// The file edits: add, update and remove the files the schema manages. Like
// the variable edits, each returns a new, validated document or the errors
// that stopped it, and keeps the order of files and of their fields.

import {
  type FileInput,
  type SchemaDocument,
  type SchemaEditResult,
  validateDocument,
} from './document.ts';
import { refuse } from './errors.ts';

/**
 * Field changes for `updateFile`: a value sets the field, and `null` or
 * `undefined` removes it. `path` renames the file.
 */
export type FileChanges = Readonly<Record<string, unknown>>;

const notAFile = (path: string) =>
  refuse(['files'], `${path} is not a file of the schema`);

/** The position of the file at `path`, or -1. */
const fileIndex = (document: SchemaDocument, path: string) =>
  document.files.findIndex((file) => file.path === path);

/** Adds a file, last or at `index`. */
export function addFile(
  document: SchemaDocument,
  spec: FileInput,
  options: { index?: number } = {},
): SchemaEditResult {
  const next = structuredClone(document);
  next.files.splice(
    options.index ?? next.files.length,
    0,
    structuredClone(spec),
  );
  return validateDocument(next);
}

/**
 * Changes the fields of the file at `path` in place: a changed field keeps
 * its position and a new one goes last.
 */
export function updateFile(
  document: SchemaDocument,
  path: string,
  changes: FileChanges,
): SchemaEditResult {
  const index = fileIndex(document, path);
  if (index === -1) return notAFile(path);
  const next = structuredClone(document);
  const file = next.files[index] as Record<string, unknown>;
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined || value === null) delete file[field];
    else file[field] = structuredClone(value);
  }
  return validateDocument(next);
}

/** Removes the file at `path`; the variables it held stay declared. */
export function removeFile(
  document: SchemaDocument,
  path: string,
): SchemaEditResult {
  const index = fileIndex(document, path);
  if (index === -1) return notAFile(path);
  const next = structuredClone(document);
  next.files.splice(index, 1);
  return validateDocument(next);
}
