// Renames a variable and every reference to it: the rules of other
// variables (`requiredUnless`, `conflictsWith`, `distinctFrom`, `within`)
// and each file's variable list, `values` and `comments`. The variable, and
// each renamed key, keeps its position.

import {
  type SchemaDocument,
  type SchemaEditResult,
  validateDocument,
} from './document.ts';
import { notDeclared, refuse } from './errors.ts';
import { findReferences } from './references.ts';

/** `record` with the key `from` renamed to `to`, in the same position. */
function renameKey<T>(
  record: Record<string, T>,
  from: string,
  to: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === from ? to : key,
      value,
    ]),
  );
}

/** Renames `from` to `to` throughout the document. */
export function renameVariable(
  document: SchemaDocument,
  from: string,
  to: string,
): SchemaEditResult {
  if (!Object.hasOwn(document.variables, from)) return notDeclared(from);
  if (from === to) return validateDocument(structuredClone(document));
  if (Object.hasOwn(document.variables, to))
    return refuse(['variables', to], `${to} is already declared`);
  const next = structuredClone(document);
  for (const reference of findReferences(document, from)) {
    if (reference.kind === 'rule') {
      const spec = next.variables[reference.variable] as Record<
        string,
        unknown
      >;
      if (reference.index === undefined) spec[reference.field] = to;
      else (spec[reference.field] as string[])[reference.index] = to;
    } else if (reference.kind === 'file') {
      const names = next.files[reference.file]?.variables as string[];
      names[reference.index] = to;
    } else {
      const file = next.files[reference.file];
      const map = file?.[reference.kind];
      if (file && map) file[reference.kind] = renameKey(map, from, to);
    }
  }
  next.variables = renameKey(next.variables, from, to);
  return validateDocument(next);
}
