// What a removal leaves behind: the places that name a variable, and the
// variables a file was the only one to hold.

import {
  type Reference,
  type SchemaDocument,
  findReferences,
} from '@configure-env/core/schema';
import type { TFunction } from 'i18next';

/** A reference as a person reads it, like `API_KEY · requiredUnless`. */
export function describeReference(
  t: TFunction,
  document: SchemaDocument,
  reference: Reference,
): string {
  if (reference.kind === 'rule')
    return t('schemaEditor.remove.reference.rule', {
      variable: reference.variable,
      field: reference.field,
    });
  const file = document.files[reference.file]?.path ?? '';
  return t(`schemaEditor.remove.reference.${reference.kind}`, { file });
}

/** The places that name `name`, described, each once. */
export function referencesTo(
  t: TFunction,
  document: SchemaDocument,
  name: string,
): string[] {
  return [
    ...new Set(
      findReferences(document, name).map((reference) =>
        describeReference(t, document, reference),
      ),
    ),
  ];
}

/** The variables a file holds, in its order. */
export const heldBy = (
  document: SchemaDocument,
  file: SchemaDocument['files'][number],
): string[] =>
  file.variables === '*' ? Object.keys(document.variables) : file.variables;

/** The variables the file at `path` holds that no other file does. */
export function orphanedBy(document: SchemaDocument, path: string): string[] {
  const file = document.files.find((candidate) => candidate.path === path);
  if (!file) return [];
  const elsewhere = new Set(
    document.files
      .filter((other) => other !== file)
      .flatMap((other) => heldBy(document, other)),
  );
  return heldBy(document, file).filter((name) => !elsewhere.has(name));
}
