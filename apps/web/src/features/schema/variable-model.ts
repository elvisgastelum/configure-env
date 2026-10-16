// The variable form's values and how they map to a variable spec, as
// env.schema.json writes it. The form never checks a rule on its own: its
// zod schema applies the edit to the schema with the core's writer, which
// validates the whole document with the core's `envSchema`, and puts each
// error the writer reports back on the field its JSON path names. A 422 from
// the API is mapped onto the fields the same way.

import {
  type CidrFamily,
  type Encoding,
  RULE_FIELDS,
  type SchemaDocument,
  VARIABLE_NAME,
  VARIABLE_TYPES,
  type VariableInput,
  type VariableType,
  ruleNames,
  sameJson,
  validateValue,
  variableSpec,
} from '@configure-env/core/schema';
import type { SchemaError } from '@configure-env/api-client';
import type { TFunction } from 'i18next';
import type { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { type SchemaEdit, previewEdit } from './edits';
import { parseIssuePath } from './paths';

export type Tristate = 'default' | 'true' | 'false';
export type ProtectedChoice = 'no' | 'yes' | 'reason';

export interface VariableFormValues {
  name: string;
  type: VariableType;
  description: string;
  group: string;
  comment: string;
  required: boolean;
  secret: boolean;
  allowEmpty: Tristate;
  protected: ProtectedChoice;
  protectedReason: string;
  default: string;
  example: string;
  requiredUnless: string[];
  conflictsWith: string[];
  distinctFrom: string[];
  within: string;
  minLength: string;
  maxLength: string;
  pattern: string;
  patternMessage: string;
  encoding: '' | Encoding;
  bytes: string;
  min: string;
  max: string;
  /** The enum values, as objects for useFieldArray. */
  values: { value: string }[];
  /** URL schemes, separated by commas or spaces. */
  protocols: string;
  family: CidrFamily;
  strict: boolean;
  /** For a new variable: the files whose variable list it joins. */
  files: string[];
}

export type VariableField = keyof VariableFormValues;

/** The fields each type takes, read from the core's own definitions. */
const SHAPES = new Map(
  variableSpec.options.map((option) => [
    option.shape.type.value as VariableType,
    new Set(Object.keys(option.shape)),
  ]),
);

/** The fields every type shares, `type` and `default` among them. */
const COMMON = new Set(
  [...SHAPES.get('string')!].filter((field) =>
    [...SHAPES.values()].every((fields) => fields.has(field)),
  ),
);

/** The options only some types take, for `type`, in definition order. */
export const typeFields = (type: VariableType): VariableField[] =>
  [...(SHAPES.get(type) ?? [])].filter(
    (field) => !COMMON.has(field),
  ) as VariableField[];

export const TYPES = VARIABLE_TYPES;

/** The form for a new variable. */
export const EMPTY_VARIABLE: VariableFormValues = {
  name: '',
  type: 'string',
  description: '',
  group: '',
  comment: '',
  required: false,
  secret: false,
  allowEmpty: 'default',
  protected: 'no',
  protectedReason: '',
  default: '',
  example: '',
  requiredUnless: [],
  conflictsWith: [],
  distinctFrom: [],
  within: '',
  minLength: '',
  maxLength: '',
  pattern: '',
  patternMessage: '',
  encoding: '',
  bytes: '',
  min: '',
  max: '',
  values: [],
  protocols: '',
  family: 'any',
  strict: false,
  files: [],
};

type Spec = Record<string, unknown>;

const text = (value: unknown) =>
  value === undefined || value === null ? '' : String(value);

/** The form values of a variable as written. */
export function fromSpec(
  name: string,
  input: VariableInput,
): VariableFormValues {
  const spec = input as Spec;
  const reason =
    typeof spec.protected === 'object' && spec.protected
      ? (spec.protected as { reason: string }).reason
      : '';
  return {
    ...EMPTY_VARIABLE,
    name,
    type: input.type,
    description: text(spec.description),
    group: text(spec.group),
    comment: text(spec.comment),
    required: spec.required === true,
    secret: spec.secret === true,
    allowEmpty:
      spec.allowEmpty === undefined
        ? 'default'
        : spec.allowEmpty
          ? 'true'
          : 'false',
    protected:
      spec.protected === undefined
        ? 'no'
        : spec.protected === true
          ? 'yes'
          : 'reason',
    protectedReason: reason,
    default: text(spec.default),
    example: text(spec.example),
    requiredUnless: ruleNames(
      spec.requiredUnless as string | string[] | undefined,
    ),
    conflictsWith: ruleNames(
      spec.conflictsWith as string | string[] | undefined,
    ),
    distinctFrom: ruleNames(spec.distinctFrom as string | string[] | undefined),
    within: text(spec.within),
    minLength: text(spec.minLength),
    maxLength: text(spec.maxLength),
    pattern: text(spec.pattern),
    patternMessage: text(spec.patternMessage),
    encoding: (spec.encoding as Encoding | undefined) ?? '',
    bytes: text(spec.bytes),
    min: text(spec.min),
    max: text(spec.max),
    values: ((spec.values as string[] | undefined) ?? []).map((value) => ({
      value,
    })),
    protocols: ((spec.protocols as string[] | undefined) ?? []).join(', '),
    family: (spec.family as CidrFamily | undefined) ?? 'any',
    strict: spec.strict === true,
  };
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMERIC_TYPES = new Set<VariableType>(['number', 'integer', 'port']);

/**
 * A typed field as the schema takes it: a number for a number, or the text
 * itself when it is not one, so the core reports the wrong type.
 */
const asNumber = (value: string) =>
  NUMBER.test(value.trim()) ? Number(value) : value;

/** `default` or `example` typed for the variable's type. */
function typedValue(type: VariableType, value: string): unknown {
  if (NUMERIC_TYPES.has(type)) return asNumber(value);
  if (type === 'boolean')
    return value === 'true' ? true : value === 'false' ? false : value;
  return value;
}

/** One name as a string, more as a list, as env.schema.json writes them. */
const names = (list: string[]) => (list.length === 1 ? list[0] : list);

/** The spec the form describes, with only the fields that are set. */
export function toSpec(values: VariableFormValues): VariableInput {
  const spec: Spec = { type: values.type };
  const set = (field: string, value: unknown, keep: boolean) => {
    if (keep) spec[field] = value;
  };
  set('description', values.description, values.description !== '');
  set('group', values.group, values.group !== '');
  set('required', true, values.required);
  set('secret', true, values.secret);
  set(
    'allowEmpty',
    values.allowEmpty === 'true',
    values.allowEmpty !== 'default',
  );
  set(
    'protected',
    values.protected === 'reason' ? { reason: values.protectedReason } : true,
    values.protected !== 'no',
  );
  set('comment', values.comment, values.comment !== '');
  set(
    'default',
    typedValue(values.type, values.default),
    values.default !== '',
  );
  set(
    'example',
    typedValue(values.type, values.example),
    values.example !== '',
  );
  for (const field of [
    'requiredUnless',
    'conflictsWith',
    'distinctFrom',
  ] as const)
    set(field, names(values[field]), values[field].length > 0);

  const takes = new Set(typeFields(values.type));
  const option = (field: VariableField, value: unknown, keep: boolean) =>
    set(field, value, takes.has(field) && keep);
  option('within', values.within, values.within !== '');
  option('minLength', asNumber(values.minLength), values.minLength !== '');
  option('maxLength', asNumber(values.maxLength), values.maxLength !== '');
  option('pattern', values.pattern, values.pattern !== '');
  option('patternMessage', values.patternMessage, values.patternMessage !== '');
  option('encoding', values.encoding, values.encoding !== '');
  option('bytes', asNumber(values.bytes), values.bytes !== '');
  option('min', asNumber(values.min), values.min !== '');
  option('max', asNumber(values.max), values.max !== '');
  option(
    'values',
    values.values.map((entry) => entry.value),
    true,
  );
  const protocols = values.protocols.split(/[\s,]+/).filter(Boolean);
  option('protocols', protocols, protocols.length > 0);
  option('family', values.family, values.family !== 'any');
  option('strict', true, values.strict);
  return spec as VariableInput;
}

/**
 * The changes from `original` to the form's spec: only fields whose value
 * differs once both go through the form, so an untouched field keeps its
 * JSON exactly (a one-name list stays a list, `"family": "any"` stays).
 */
export function specChanges(
  original: VariableInput,
  next: VariableInput,
): Record<string, unknown> {
  const before = toSpec(fromSpec('', original)) as Spec;
  const after = next as Spec;
  const changes: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (!sameJson(before[field], after[field]))
      changes[field] = after[field] ?? null;
  return changes;
}

/** The edit the form makes: a new variable, or changes to `original`. */
export function variableEdit(
  document: SchemaDocument,
  original: string | undefined,
  values: VariableFormValues,
): SchemaEdit {
  const spec = toSpec(values);
  if (original === undefined)
    return {
      kind: 'addVariable',
      name: values.name,
      spec,
      ...(values.files.length ? { files: values.files } : {}),
    };
  const current = document.variables[original];
  return {
    kind: 'updateVariable',
    name: original,
    changes: current ? specChanges(current, spec) : (spec as Spec),
    ...(values.name !== original ? { rename: values.name } : {}),
  };
}

const RULES = new Set<string>(RULE_FIELDS);

/**
 * The form field an error path is about, for the variable being edited
 * (its names before and after a rename); `root` for one the form has no
 * field for.
 */
export function fieldForPath(
  path: string,
  variable: readonly string[],
): VariableField | 'root' {
  const segments = parseIssuePath(path);
  if (!segments) return 'root';
  const [scope, name, field, next] = segments;
  if (scope === 'files') return 'files';
  if (scope !== 'variables' || !variable.includes(String(name))) return 'root';
  if (field === undefined) return 'name';
  if (field === 'protected')
    return next === 'reason' ? 'protectedReason' : 'protected';
  if (RULES.has(String(field)) || Object.hasOwn(EMPTY_VARIABLE, String(field)))
    return field as VariableField;
  return 'root';
}

/** A field's text that should be a number, or an integer, and is not. */
function numberProblems(t: TFunction, values: VariableFormValues) {
  const problems: [VariableField, string][] = [];
  const takes = new Set(typeFields(values.type));
  // Lengths and byte counts are counts; an integer's bounds may be signed.
  const counts: VariableField[] = ['minLength', 'maxLength', 'bytes'];
  const whole: [VariableField, RegExp][] = counts.map((field) => [
    field,
    /^\d+$/,
  ]);
  if (values.type === 'integer')
    whole.push(['min', /^[+-]?\d+$/], ['max', /^[+-]?\d+$/]);
  for (const [field, pattern] of whole)
    if (
      takes.has(field) &&
      values[field] !== '' &&
      !pattern.test(String(values[field]).trim())
    )
      problems.push([field, t('schemaEditor.variableForm.wholeNumber')]);
  for (const field of ['min', 'max'] as const)
    if (
      takes.has(field) &&
      values.type === 'number' &&
      values[field] !== '' &&
      !NUMBER.test(values[field].trim())
    )
      problems.push([field, t('schemaEditor.variableForm.number')]);
  return problems;
}

/**
 * The form's schema: the name, the numbers, then the edit itself against
 * the document, with each core error on its field. Its output is the edit.
 * The form's own messages are in `t`'s language; the core's are as it says them.
 */
export function variableFormSchema(
  document: SchemaDocument,
  original: string | undefined,
  t: TFunction,
) {
  return z
    .custom<VariableFormValues>()
    .superRefine((values, ctx) => {
      let failed = false;
      const fail = (field: VariableField | 'root', message: string) => {
        failed = true;
        ctx.addIssue({ code: 'custom', path: [field], message });
      };
      if (!VARIABLE_NAME.test(values.name))
        fail('name', t('schemaEditor.variableForm.nameInvalid'));
      for (const [field, message] of numberProblems(t, values))
        fail(field, message);
      // A name or number the form already refuses would only add noise.
      if (failed) return;
      const result = previewEdit(
        document,
        variableEdit(document, original, values),
      );
      if (result.ok) return;
      const names = [values.name, ...(original ? [original] : [])];
      const unplaced: string[] = [];
      for (const error of result.errors) {
        const field = fieldForPath(error.path, names);
        if (field === 'root') unplaced.push(`${error.path}: ${error.message}`);
        else fail(field, error.message);
      }
      if (unplaced.length) fail('root', unplaced.join('\n'));
    })
    .transform((values) => variableEdit(document, original, values));
}

/**
 * The fields a switch to `next` would lose: the options of the current
 * type that `next` does not take and that hold something, and a default or
 * example that is not a valid value of `next`.
 */
export function droppedBySwitch(
  values: VariableFormValues,
  next: VariableType,
): VariableField[] {
  const kept = new Set(typeFields(next));
  const dropped = typeFields(values.type).filter(
    (field) =>
      !kept.has(field) &&
      JSON.stringify(values[field]) !== JSON.stringify(EMPTY_VARIABLE[field]),
  );
  for (const field of ['default', 'example'] as const) {
    const value = values[field];
    if (value === '') continue;
    const spec = variableSpec.safeParse({ type: next });
    if (!spec.success || !validateValue(spec.data, value).ok)
      dropped.push(field);
  }
  return dropped;
}

/** The variable form, whose submit yields the edit. */
export type VariableForm = UseFormReturn<
  VariableFormValues,
  unknown,
  SchemaEdit
>;

/** Puts the API's errors (422) on the fields their paths name. */
export function showServerErrors(
  form: VariableForm,
  errors: readonly SchemaError[],
  names: readonly string[],
) {
  const unplaced: string[] = [];
  for (const error of errors) {
    const field = fieldForPath(error.path, names);
    if (field === 'root') unplaced.push(`${error.path}: ${error.message}`);
    else form.setError(field, { type: 'server', message: error.message });
  }
  if (unplaced.length)
    form.setError('root.server', {
      type: 'server',
      message: unplaced.join('\n'),
    });
}
