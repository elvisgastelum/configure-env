// Where a schema names a variable: the rules of other variables, and each
// file's variable list, `values` and `comments`. Removing a variable checks
// these first; renaming one rewrites them.

import { RULE_FIELDS, type RuleField } from '../schema/definition.ts';
import { formatIssuePath } from '../schema/parse.ts';
import type { SchemaDocument } from './document.ts';

/** One place that names a variable. */
export type Reference =
  | {
      kind: 'rule';
      variable: string;
      field: RuleField;
      /** The position in a list; absent when the field holds one name. */
      index?: number;
    }
  | { kind: 'file'; file: number; index: number }
  | { kind: 'values' | 'comments'; file: number };

/** The names a rule field holds, as written. */
export const ruleField = (
  spec: object,
  field: RuleField,
): string | readonly string[] | undefined =>
  (spec as Partial<Record<RuleField, string | readonly string[]>>)[field];

/** Every place in the document that names `name`, in document order. */
export function findReferences(
  document: SchemaDocument,
  name: string,
): Reference[] {
  const found: Reference[] = [];
  for (const [variable, spec] of Object.entries(document.variables)) {
    if (variable === name) continue;
    for (const field of RULE_FIELDS) {
      const names = ruleField(spec, field);
      if (typeof names === 'string') {
        if (names === name) found.push({ kind: 'rule', variable, field });
      } else
        names?.forEach((other, index) => {
          if (other === name)
            found.push({ kind: 'rule', variable, field, index });
        });
    }
  }
  document.files.forEach((file, index) => {
    if (Array.isArray(file.variables))
      file.variables.forEach((other, position) => {
        if (other === name)
          found.push({ kind: 'file', file: index, index: position });
      });
    for (const kind of ['values', 'comments'] as const)
      if (file[kind] && Object.hasOwn(file[kind], name))
        found.push({ kind, file: index });
  });
  return found;
}

/** Where a reference to `name` is, as an error path. */
export function referencePath(reference: Reference, name: string): string {
  switch (reference.kind) {
    case 'rule':
      return formatIssuePath([
        'variables',
        reference.variable,
        reference.field,
        ...(reference.index === undefined ? [] : [reference.index]),
      ]);
    case 'file':
      return formatIssuePath([
        'files',
        reference.file,
        'variables',
        reference.index,
      ]);
    default:
      return formatIssuePath(['files', reference.file, reference.kind, name]);
  }
}

/** The paths of every place in the document that names `name`. */
export function variableReferences(
  document: SchemaDocument,
  name: string,
): string[] {
  return findReferences(document, name).map((reference) =>
    referencePath(reference, name),
  );
}
