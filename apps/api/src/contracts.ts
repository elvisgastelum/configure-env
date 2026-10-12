// The API's wire format as zod schemas: requests are validated with them,
// responses are shaped by them (an allowlist: undeclared fields never leave
// the server), and the OpenAPI document's components are generated from
// them, so the generated client's types follow.

import {
  type DriftStatus,
  FILE_POLICIES,
  RULE_FIELDS,
  variableSpec,
} from '@configure-env/core';
import { z } from 'zod';

const DRIFT_STATUSES = [
  'current',
  'missing',
  'differs',
  'missing-keys',
  'refused',
] as const satisfies readonly DriftStatus[];

/** The schemas published as OpenAPI components, by component name. */
export const components = z.registry<{ id: string }>();

const named = <T extends z.ZodType>(id: string, schema: T): T => {
  components.add(schema, { id });
  return schema;
};

export const healthResponse = named(
  'Health',
  z.object({ status: z.literal('ok') }),
);

export const projectResponse = named(
  'Project',
  z.object({
    root: z
      .string()
      .meta({ description: 'The real path of the project root.' }),
    schemaPath: z
      .string()
      .meta({ description: 'The schema file, relative to the root.' }),
    version: z.string().meta({ description: 'The configure-env version.' }),
  }),
);

export const schemaError = named(
  'SchemaError',
  z.object({
    path: z
      .string()
      .meta({ description: 'Where, like `files[1].variables[0]`.' }),
    message: z.string(),
    line: z.int().optional(),
    column: z.int().optional(),
  }),
);

export const schemaResponse = named(
  'Schema',
  z.object({
    path: z.string(),
    valid: z.boolean(),
    document: z.unknown().meta({
      description:
        'The schema file as parsed JSON, valid or not; null when it cannot be read or parsed.',
    }),
    errors: z.array(schemaError),
  }),
);

export const invalidSchemaResponse = named(
  'InvalidSchema',
  z.object({
    statusCode: z.literal(422),
    message: z.string(),
    errors: z.array(schemaError),
  }),
);

export const errorResponse = named(
  'ApiError',
  z.object({ statusCode: z.int(), message: z.string() }),
);

export const VALUE_STATUSES = ['set', 'missing', 'invalid', 'masked'] as const;

export const fileValue = named(
  'FileValue',
  z.object({
    file: z.string(),
    status: z.enum(VALUE_STATUSES).meta({
      description:
        'set: a valid value, shown; masked: a valid secret, masked; invalid: breaks its rules; missing: not in the file, or no file.',
    }),
    value: z.string().optional().meta({
      description:
        'The value; a secret only ever masked. Absent when it is missing.',
    }),
    error: z.string().optional().meta({
      description: 'Why it is invalid; never holds the value.',
    }),
  }),
);

export const variable = named(
  'Variable',
  z.object({
    name: z.string(),
    spec: variableSpec,
    files: z.array(fileValue),
  }),
);

export const variablesResponse = named(
  'Variables',
  z.object({ variables: z.array(variable) }),
);

export const parseError = named(
  'ParseError',
  z.object({ line: z.int(), message: z.string() }),
);

export const fileInfo = named(
  'FileInfo',
  z.object({
    path: z.string(),
    policy: z.enum(FILE_POLICIES),
    template: z.boolean(),
    exists: z.boolean(),
    mode: z.object({
      expected: z.string().nullable().meta({
        description: 'The schema mode, like `600`; null when it sets none.',
      }),
      actual: z.string().nullable().meta({
        description: 'The file mode; null when the file does not exist.',
      }),
    }),
    drift: z.object({
      status: z.enum(DRIFT_STATUSES),
      drift: z.boolean(),
      missingKeys: z.array(z.string()),
      unknownKeys: z.array(z.string()),
    }),
    parseErrors: z.array(parseError),
    error: z
      .string()
      .optional()
      .meta({ description: 'Why the path was refused.' }),
  }),
);

export const filesResponse = named(
  'Files',
  z.object({ files: z.array(fileInfo) }),
);

export const revealRequest = named(
  'RevealRequest',
  z.strictObject({
    file: z.string().min(1).meta({ description: 'A schema file path.' }),
    key: z.string().min(1),
  }),
);

export const revealResponse = named(
  'Reveal',
  z.object({
    file: z.string(),
    key: z.string(),
    value: z.string().nullable().meta({ description: 'Null when not set.' }),
  }),
);

export const strictQuery = z.object({
  strict: z.enum(['true', 'false']).optional().meta({
    description: 'Treat keys the schema does not list for a file as errors.',
  }),
});

const ruleProblem = named(
  'RuleProblem',
  z.object({
    rule: z.enum(RULE_FIELDS),
    key: z.string(),
    others: z.array(z.string()),
    message: z.string(),
  }),
);

const fileDrift = named(
  'FileDrift',
  z.object({
    path: z.string(),
    policy: z.enum(FILE_POLICIES),
    status: z.enum(DRIFT_STATUSES),
    drift: z.boolean(),
    missingKeys: z.array(z.string()),
    unknownKeys: z.array(z.string()),
    invalid: z.array(
      z.object({
        key: z.string(),
        message: z.string(),
        shown: z
          .string()
          .meta({ description: 'The value for display, masked when secret.' }),
      }),
    ),
    rules: z.array(ruleProblem),
    invalidLines: z.array(z.int()),
    protected: z.array(
      z.object({
        kind: z.literal('protected'),
        key: z.string(),
        message: z.string(),
        reason: z.string().optional(),
      }),
    ),
    mode: z.object({ actual: z.string(), expected: z.string() }).optional(),
    error: z.string().optional(),
  }),
);

const planError = named(
  'PlanError',
  z.object({
    kind: z.enum(['value', 'file']),
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    path: z.string().optional(),
    message: z.string(),
  }),
);

export const checkResponse = named(
  'Check',
  z.object({
    ok: z
      .boolean()
      .meta({ description: 'No drift, no invalid value, no error.' }),
    drift: z.boolean(),
    files: z.array(fileDrift),
    errors: z.array(planError),
  }),
);

const problem = named(
  'Problem',
  z.object({
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    line: z.int().optional(),
    message: z.string(),
  }),
);

export const validateResponse = named(
  'Validate',
  z.object({
    ok: z.boolean(),
    files: z.array(
      named(
        'FileValidation',
        z.object({
          path: z.string(),
          template: z.boolean(),
          exists: z.boolean(),
          ok: z.boolean(),
          errors: z.array(problem),
          warnings: z.array(problem),
        }),
      ),
    ),
  }),
);
