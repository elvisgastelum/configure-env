// The env schema v1 (`env.schema.json`): the single source of truth for its
// format. The loader validates with it, the TS types come from it, and
// schema/env.schema.v1.json is generated from it (`pnpm schema:generate`).
//
// Every object is strict, so a misspelled key is an error, not ignored.

import { z } from 'zod';
import { validateValue } from './values.ts';

export const SCHEMA_VERSION = 1;

export const SCHEMA_ID =
  'https://raw.githubusercontent.com/elvisgastelum/configure-env/main/schema/env.schema.v1.json';

/** A variable name, as env files and shells accept it. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const variableName = z
  .string()
  .regex(
    VARIABLE_NAME,
    'variable names must start with a letter or underscore and hold only letters, digits and underscores',
  );

export const VARIABLE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
  'email',
  'url',
  'host',
  'ipv4',
  'port',
] as const;

export type VariableType = (typeof VARIABLE_TYPES)[number];

/** The fields every variable type shares. */
const common = {
  description: z
    .string()
    .optional()
    .meta({ description: 'What the variable is for.' }),
  group: z
    .string()
    .optional()
    .meta({ description: 'A heading that groups related variables.' }),
  required: z
    .boolean()
    .default(false)
    .meta({ description: 'Whether the variable must be set.' }),
  secret: z.boolean().default(false).meta({
    description: 'Mask the value in output and never echo it in errors.',
  }),
  allowEmpty: z.boolean().optional().meta({
    description:
      'Whether an empty value is accepted. Defaults to true when the variable is not required.',
  }),
  comment: z.string().optional().meta({
    description:
      'Text written as `#` comment lines above the key in generated files; may span lines.',
  }),
};

/** `default` and `example`, typed for the variable type. */
const valueFields = <T extends z.ZodType>(value: T) => ({
  default: value
    .optional()
    .meta({ description: 'The value used when none is given.' }),
  example: value
    .optional()
    .meta({ description: 'A sample value shown to people.' }),
});

const nonNegativeInt = z.int().nonnegative();
const protocol = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9+.-]*:?$/, 'must be a URL scheme, like "https"');

const stringVariable = z.strictObject({
  type: z.literal('string'),
  ...common,
  ...valueFields(z.string()),
  minLength: nonNegativeInt.optional(),
  maxLength: nonNegativeInt.optional(),
  pattern: z.string().optional().meta({
    description: 'A JavaScript regular expression (Unicode mode).',
  }),
  patternMessage: z.string().optional().meta({
    description: 'The error shown when the value does not match `pattern`.',
  }),
});

const numberVariable = z.strictObject({
  type: z.literal('number'),
  ...common,
  ...valueFields(z.number()),
  min: z.number().optional(),
  max: z.number().optional(),
});

const integerVariable = z.strictObject({
  type: z.literal('integer'),
  ...common,
  ...valueFields(z.int()),
  min: z.int().optional(),
  max: z.int().optional(),
});

const booleanVariable = z.strictObject({
  type: z.literal('boolean'),
  ...common,
  ...valueFields(z.boolean()),
});

const enumVariable = z.strictObject({
  type: z.literal('enum'),
  ...common,
  ...valueFields(z.string()),
  values: z
    .array(z.string())
    .min(1)
    .meta({ description: 'The accepted values.' }),
});

const emailVariable = z.strictObject({
  type: z.literal('email'),
  ...common,
  ...valueFields(z.string()),
});

const urlVariable = z.strictObject({
  type: z.literal('url'),
  ...common,
  ...valueFields(z.string()),
  protocols: z.array(protocol).min(1).optional().meta({
    description: 'The accepted URL schemes, like ["https"]; any when absent.',
  }),
});

const hostVariable = z.strictObject({
  type: z.literal('host'),
  ...common,
  ...valueFields(z.string()),
});

const ipv4Variable = z.strictObject({
  type: z.literal('ipv4'),
  ...common,
  ...valueFields(z.string()),
});

const portVariable = z.strictObject({
  type: z.literal('port'),
  ...common,
  ...valueFields(z.int()),
});

/** One variable: its type, its type's options and the common fields. */
export const variableSpec = z.discriminatedUnion(
  'type',
  [
    stringVariable,
    numberVariable,
    integerVariable,
    booleanVariable,
    enumVariable,
    emailVariable,
    urlVariable,
    hostVariable,
    ipv4Variable,
    portVariable,
  ],
  { error: `type must be one of ${VARIABLE_TYPES.join(', ')}` },
);

/** Why `path` is not a safe relative POSIX path, or undefined when it is. */
export function filePathProblem(path: string): string | undefined {
  if (!path) return 'must not be empty';
  if (path.includes('\0')) return 'must not contain a NUL byte';
  if (path.includes('\\')) return 'must use forward slashes';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path))
    return 'must be relative, not absolute';
  for (const segment of path.split('/')) {
    if (segment === '..') return 'must not contain `..` segments';
    if (segment === '.') return 'must not contain `.` segments';
    if (!segment) return 'must not contain empty segments';
  }
  return undefined;
}

const filePath = z
  .string()
  .superRefine((path, ctx) => {
    const problem = filePathProblem(path);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  })
  .meta({
    description:
      'Relative to the project root, with forward slashes; no `..` or absolute paths.',
  });

export const FILE_POLICIES = ['generate', 'merge', 'create-only'] as const;

/** One file the tool manages. */
export const fileSpec = z.strictObject({
  path: filePath,
  policy: z.enum(FILE_POLICIES).meta({
    description:
      'generate: rewrite the whole file; merge: append missing keys and keep the rest; create-only: write it only when it does not exist.',
  }),
  variables: z.union([z.literal('*'), z.array(variableName)]).meta({
    description:
      '"*" for every variable in declaration order, or the variable names in output order.',
  }),
  mode: z
    .string()
    .regex(/^[0-7]{3}$/, 'mode must be three octal digits, like "600"')
    .optional()
    .meta({ description: 'The file permissions, like "600" or "644".' }),
  header: z.string().optional().meta({
    description:
      'Text written as `#` comment lines at the top of the file; may span lines.',
  }),
  description: z.string().optional(),
  template: z.boolean().optional().meta({
    description:
      'Whether the file is a template, committed with placeholders: it takes only `values` and defaults, never values a person or the environment gives. Defaults to true when the path ends in .example, .sample or .template.',
  }),
  values: z
    .record(
      variableName,
      z.string().regex(/^[^\r\n]*$/, 'must not contain a line break'),
    )
    .optional()
    .meta({
      description:
        'Literal values for this file that replace the defaults, like placeholders in an example file. Written after `KEY=` as is; not type-checked.',
    }),
  comments: z.record(variableName, z.string()).optional().meta({
    description:
      "Comments for this file that replace the variables' own `comment`; may span lines.",
  }),
});

const envSchemaObject = z.strictObject({
  $schema: z
    .string()
    .optional()
    .meta({ description: 'The JSON Schema URL, for editors.' }),
  version: z.literal(SCHEMA_VERSION, { error: 'version must be 1' }),
  variables: z.record(variableName, variableSpec),
  files: z.array(fileSpec),
});

type Ctx = z.core.$RefinementCtx<z.output<typeof envSchemaObject>>;
type Path = (string | number)[];

const issue = (ctx: Ctx, path: Path, message: string) =>
  ctx.addIssue({ code: 'custom', path, message });

/** Checks the type options against each other; true when they are sound. */
function checkOptions(spec: VariableSpec, path: Path, ctx: Ctx): boolean {
  let sound = true;
  const fail = (field: string, message: string) => {
    issue(ctx, [...path, field], message);
    sound = false;
  };
  switch (spec.type) {
    case 'string':
      if (spec.pattern !== undefined) {
        try {
          new RegExp(spec.pattern, 'u');
        } catch {
          fail('pattern', 'pattern is not a valid regular expression');
        }
      }
      if (
        spec.minLength !== undefined &&
        spec.maxLength !== undefined &&
        spec.minLength > spec.maxLength
      )
        fail('minLength', 'minLength must not exceed maxLength');
      break;
    case 'number':
    case 'integer':
      if (
        spec.min !== undefined &&
        spec.max !== undefined &&
        spec.min > spec.max
      )
        fail('min', 'min must not exceed max');
      break;
    case 'enum':
      if (new Set(spec.values).size !== spec.values.length)
        fail('values', 'values must not repeat');
      break;
  }
  return sound;
}

/** Checks `default` and `example` against the variable's own rules. */
function checkValues(spec: VariableSpec, path: Path, ctx: Ctx) {
  for (const field of ['default', 'example'] as const) {
    const value = spec[field];
    if (value === undefined) continue;
    const result = validateValue(spec, String(value));
    if (!result.ok)
      issue(ctx, [...path, field], `invalid ${field}: ${result.error}`);
  }
}

function checkFiles(schema: z.output<typeof envSchemaObject>, ctx: Ctx) {
  const declared = new Set(Object.keys(schema.variables));
  const seenPaths = new Map<string, number>();
  schema.files.forEach((file, index) => {
    const at = (...rest: Path): Path => ['files', index, ...rest];

    const first = seenPaths.get(file.path);
    if (first === undefined) seenPaths.set(file.path, index);
    else issue(ctx, at('path'), `duplicates the path of files[${first}]`);

    let held = declared;
    if (file.variables !== '*') {
      held = new Set();
      file.variables.forEach((name, position) => {
        if (!declared.has(name))
          issue(
            ctx,
            at('variables', position),
            `${name} is not declared in variables`,
          );
        else if (held.has(name))
          issue(ctx, at('variables', position), `${name} is listed twice`);
        held.add(name);
      });
    }

    for (const field of ['values', 'comments'] as const) {
      for (const name of Object.keys(file[field] ?? {})) {
        if (!held.has(name))
          issue(
            ctx,
            at(field, name),
            `${name} is not one of this file's variables`,
          );
      }
    }
  });
}

/** The whole `env.schema.json`. */
export const envSchema = envSchemaObject
  .superRefine((schema, ctx) => {
    for (const [name, spec] of Object.entries(schema.variables)) {
      const path = ['variables', name];
      if (checkOptions(spec, path, ctx)) checkValues(spec, path, ctx);
    }
    checkFiles(schema, ctx);
  })
  .meta({
    title: 'configure-env schema v1',
    description:
      'The env files a project needs and the variables they hold, for configure-env.',
  });

export type EnvSchema = z.output<typeof envSchema>;

/** The path suffixes that make a file a template unless `template` says otherwise. */
export const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template'] as const;

/**
 * Whether the file is a template: `template` when set, else whether its path
 * ends in a template suffix. A template takes only its `values` and the
 * defaults, so a secret never lands in a committed file.
 */
export function isTemplate(file: Pick<FileSpec, 'path' | 'template'>): boolean {
  return (
    file.template ??
    TEMPLATE_SUFFIXES.some((suffix) => file.path.endsWith(suffix))
  );
}
export type VariableSpec = z.output<typeof variableSpec>;
export type FileSpec = z.output<typeof fileSpec>;
export type FilePolicy = (typeof FILE_POLICIES)[number];
