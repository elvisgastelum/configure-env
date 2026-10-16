// The file form's values and how they map to a file of env.schema.json.
// Like the variable form, it checks nothing on its own beyond the shape of
// its rows: the edit is applied with the core's writer, which validates the
// whole document (the safe path among it), and each error is put back on
// the field its JSON path names.

import type { SchemaError } from '@configure-env/api-client';
import {
  type FileInput,
  type FilePolicy,
  type SchemaDocument,
  sameJson,
} from '@configure-env/core/schema';
import type { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { type SchemaEdit, previewEdit } from './edits';
import { parseIssuePath } from './paths';
import type { Tristate } from './variable-model';

export interface FileFormValues {
  path: string;
  policy: FilePolicy;
  mode: string;
  /** `"*"`: every variable, in declaration order. */
  everyVariable: boolean;
  /** The variables in output order, when not every one. */
  variables: string[];
  header: string;
  description: string;
  template: Tristate;
  values: { name: string; value: string }[];
  comments: { name: string; comment: string }[];
}

export type FileField = keyof FileFormValues;

export type FileForm = UseFormReturn<FileFormValues, unknown, SchemaEdit>;

export const EMPTY_FILE: FileFormValues = {
  path: '',
  policy: 'generate',
  mode: '',
  everyVariable: true,
  variables: [],
  header: '',
  description: '',
  template: 'default',
  values: [],
  comments: [],
};

/** The form values of a file as written. */
export function fromFile(file: FileInput): FileFormValues {
  return {
    path: file.path,
    policy: file.policy,
    mode: file.mode ?? '',
    everyVariable: file.variables === '*',
    variables: file.variables === '*' ? [] : [...file.variables],
    header: file.header ?? '',
    description: file.description ?? '',
    template:
      file.template === undefined
        ? 'default'
        : file.template
          ? 'true'
          : 'false',
    values: Object.entries(file.values ?? {}).map(([name, value]) => ({
      name,
      value,
    })),
    comments: Object.entries(file.comments ?? {}).map(([name, comment]) => ({
      name,
      comment,
    })),
  };
}

/** The file the form describes, with only the fields that are set. */
export function toFile(values: FileFormValues): FileInput {
  const file: Record<string, unknown> = {
    path: values.path,
    policy: values.policy,
    variables: values.everyVariable ? '*' : values.variables,
  };
  if (values.mode !== '') file.mode = values.mode;
  if (values.header !== '') file.header = values.header;
  if (values.description !== '') file.description = values.description;
  if (values.template !== 'default') file.template = values.template === 'true';
  if (values.values.length)
    file.values = Object.fromEntries(
      values.values.map((row) => [row.name, row.value]),
    );
  if (values.comments.length)
    file.comments = Object.fromEntries(
      values.comments.map((row) => [row.name, row.comment]),
    );
  return file as FileInput;
}

/** The variables the form's file holds, in its order. */
export const heldVariables = (
  document: SchemaDocument,
  values: Pick<FileFormValues, 'everyVariable' | 'variables'>,
) =>
  values.everyVariable ? Object.keys(document.variables) : values.variables;

/** The edit the form makes: a new file, or changes to the one at `original`. */
export function fileEdit(
  document: SchemaDocument,
  original: string | undefined,
  values: FileFormValues,
): SchemaEdit {
  const next = toFile(values) as Record<string, unknown>;
  if (original === undefined)
    return { kind: 'addFile', spec: next as FileInput };
  const current = document.files.find((file) => file.path === original);
  const before = current
    ? (toFile(fromFile(current)) as Record<string, unknown>)
    : {};
  const changes: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(before), ...Object.keys(next)]))
    if (!sameJson(before[field], next[field]))
      changes[field] = next[field] ?? null;
  return { kind: 'updateFile', path: original, changes };
}

/** Where the form's file is in the document the edit makes. */
const fileIndex = (document: SchemaDocument, original: string | undefined) =>
  original === undefined
    ? document.files.length
    : document.files.findIndex((file) => file.path === original);

/**
 * The form field an error path is about: `values.2.value` for the row that
 * holds the key the path names, say; `root` for one without a field.
 */
export function fileFieldForPath(
  path: string,
  index: number,
  values: FileFormValues,
): string {
  const segments = parseIssuePath(path);
  if (!segments || segments[0] !== 'files' || segments[1] !== index)
    return 'root';
  const [, , field, key] = segments;
  if (field === 'values' || field === 'comments') {
    const rows: { name: string }[] = values[field];
    const row = rows.findIndex((entry) => entry.name === key);
    if (row === -1) return field;
    return `${field}.${row}.${field === 'values' ? 'value' : 'name'}`;
  }
  if (field === 'variables') return 'variables';
  if (typeof field === 'string' && Object.hasOwn(EMPTY_FILE, field))
    return field;
  return 'root';
}

/** The form's schema: its rows, then the edit against the document. */
export function fileFormSchema(
  document: SchemaDocument,
  original: string | undefined,
) {
  return z
    .custom<FileFormValues>()
    .superRefine((values, ctx) => {
      let failed = false;
      const fail = (path: string, message: string) => {
        failed = true;
        ctx.addIssue({ code: 'custom', path: path.split('.'), message });
      };
      for (const field of ['values', 'comments'] as const) {
        const seen = new Set<string>();
        values[field].forEach((row, index) => {
          if (!row.name) fail(`${field}.${index}.name`, 'pick a variable');
          else if (seen.has(row.name))
            fail(`${field}.${index}.name`, `${row.name} is listed twice`);
          seen.add(row.name);
        });
      }
      if (failed) return;
      const result = previewEdit(
        document,
        fileEdit(document, original, values),
      );
      if (result.ok) return;
      const index = fileIndex(document, original);
      const unplaced: string[] = [];
      for (const error of result.errors) {
        const field = fileFieldForPath(error.path, index, values);
        if (field === 'root') unplaced.push(`${error.path}: ${error.message}`);
        else fail(field, error.message);
      }
      if (unplaced.length) fail('root', unplaced.join('\n'));
    })
    .transform((values) => fileEdit(document, original, values));
}

/** Puts the API's errors (422) on the fields their paths name. */
export function showFileServerErrors(
  form: FileForm,
  errors: readonly SchemaError[],
  document: SchemaDocument,
  original: string | undefined,
) {
  const index = fileIndex(document, original);
  const values = form.getValues();
  const unplaced: string[] = [];
  for (const error of errors) {
    const field = fileFieldForPath(error.path, index, values);
    if (field === 'root') unplaced.push(`${error.path}: ${error.message}`);
    else
      form.setError(field as FileField, {
        type: 'server',
        message: error.message,
      });
  }
  if (unplaced.length)
    form.setError('root.server', {
      type: 'server',
      message: unplaced.join('\n'),
    });
}
