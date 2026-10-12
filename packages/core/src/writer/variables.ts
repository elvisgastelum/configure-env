// The variable edits: add, update, remove and reorder. Each takes the
// document as written and returns a new one, validated with every check
// `parseSchema` makes, or the errors that stopped it; the input is never
// changed. Field order is kept, so the writer changes only what an edit did.

import {
  RULE_FIELDS,
  type VariableType,
  variableSpec,
} from '../schema/definition.ts';
import type { SchemaError } from '../schema/load.ts';
import {
  type SchemaDocument,
  type SchemaEditResult,
  type VariableInput,
  validateDocument,
} from './document.ts';
import { notDeclared, refuse } from './errors.ts';
import { findReferences, referencePath, ruleField } from './references.ts';

/**
 * Field changes for `updateVariable`: a value sets the field, and `null` or
 * `undefined` removes it.
 */
export type VariableChanges = Readonly<Record<string, unknown>>;

/** The fields each variable type takes. */
const TYPE_FIELDS = new Map<string, ReadonlySet<string>>(
  variableSpec.options.map((option) => [
    option.shape.type.value,
    new Set(Object.keys(option.shape)),
  ]),
);

/** The document with `variables` replaced. */
const withVariables = (
  document: SchemaDocument,
  variables: SchemaDocument['variables'],
): SchemaDocument => ({ ...structuredClone(document), variables });

/**
 * Adds a variable after the others. `files` names files whose variable list
 * it joins; a file that takes `"*"` holds it already.
 */
export function addVariable(
  document: SchemaDocument,
  name: string,
  spec: VariableInput,
  options: { files?: readonly string[] } = {},
): SchemaEditResult {
  if (Object.hasOwn(document.variables, name))
    return refuse(['variables', name], `${name} is already declared`);
  const next = withVariables(document, {
    ...structuredClone(document.variables),
    [name]: structuredClone(spec),
  });
  const errors: SchemaError[] = [];
  for (const path of options.files ?? []) {
    const file = next.files.find((candidate) => candidate.path === path);
    if (!file)
      errors.push({
        path: 'files',
        message: `${path} is not a file of the schema`,
      });
    else if (Array.isArray(file.variables)) file.variables.push(name);
  }
  if (errors.length) return { ok: false, errors };
  return validateDocument(next);
}

/**
 * Changes a variable's fields in place: a changed field keeps its position
 * and a new one goes last. A new `type` drops the options it does not take.
 */
export function updateVariable(
  document: SchemaDocument,
  name: string,
  changes: VariableChanges,
): SchemaEditResult {
  const current = document.variables[name];
  if (!current) return notDeclared(name);
  const next: Record<string, unknown> = structuredClone(current);
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined || value === null) delete next[field];
    else next[field] = structuredClone(value);
  }
  const fields = TYPE_FIELDS.get(next.type as VariableType);
  if (next.type !== current.type && fields)
    for (const field of Object.keys(next))
      if (!fields.has(field)) delete next[field];
  return validateDocument(
    withVariables(document, {
      ...structuredClone(document.variables),
      [name]: next as VariableInput,
    }),
  );
}

/** Removes `name` from every place that names it; the document is a copy. */
function dropReferences(document: SchemaDocument, name: string) {
  for (const spec of Object.values(document.variables)) {
    const fields = spec as Record<string, unknown>;
    for (const field of RULE_FIELDS) {
      const names = ruleField(spec, field);
      if (names === undefined) continue;
      const kept =
        typeof names === 'string'
          ? names === name
            ? []
            : names
          : names.filter((other) => other !== name);
      if (kept.length) fields[field] = kept;
      else delete fields[field];
    }
  }
  for (const file of document.files) {
    if (Array.isArray(file.variables))
      file.variables = file.variables.filter((other) => other !== name);
    for (const kind of ['values', 'comments'] as const) {
      const map = file[kind];
      if (!map) continue;
      delete map[name];
      if (!Object.keys(map).length) delete file[kind];
    }
  }
}

/**
 * Removes a variable. A rule or file that names it is reported, and nothing
 * is removed, unless `cleanup` is set: then each reference goes too, and a
 * rule or map it leaves empty is removed.
 */
export function removeVariable(
  document: SchemaDocument,
  name: string,
  options: { cleanup?: boolean } = {},
): SchemaEditResult {
  if (!Object.hasOwn(document.variables, name)) return notDeclared(name);
  const references = findReferences(document, name);
  if (references.length && !options.cleanup)
    return {
      ok: false,
      errors: references.map((reference) => ({
        path: referencePath(reference, name),
        message: `names ${name}; remove the reference first, or clean it up`,
      })),
    };
  const next = structuredClone(document);
  delete next.variables[name];
  dropReferences(next, name);
  return validateDocument(next);
}

/**
 * Puts the variables in `order`, which names each declared variable once.
 * Files that take `"*"` write them in this order.
 */
export function reorderVariables(
  document: SchemaDocument,
  order: readonly string[],
): SchemaEditResult {
  const errors: SchemaError[] = [];
  const seen = new Set<string>();
  for (const name of order) {
    if (seen.has(name))
      errors.push({ path: 'variables', message: `${name} is listed twice` });
    else if (!Object.hasOwn(document.variables, name))
      errors.push({ path: 'variables', message: `${name} is not declared` });
    seen.add(name);
  }
  for (const name of Object.keys(document.variables))
    if (!seen.has(name))
      errors.push({
        path: 'variables',
        message: `${name} is missing from the order`,
      });
  if (errors.length) return { ok: false, errors };
  const variables: SchemaDocument['variables'] = {};
  for (const name of order)
    variables[name] = structuredClone(
      document.variables[name],
    ) as VariableInput;
  return validateDocument(withVariables(document, variables));
}
