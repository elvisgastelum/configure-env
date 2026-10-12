// The API's wire format as zod schemas: requests are validated with them,
// responses are shaped by them (an allowlist: undeclared fields never leave
// the server), and the OpenAPI document's components are generated from
// them, so the generated client's types follow.

import {
  type DriftStatus,
  FILE_POLICIES,
  RULE_FIELDS,
  VARIABLE_NAME,
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
    fingerprint: z.string().optional().meta({
      description:
        'Identifies the bytes read; a schema edit names it. Absent when the file cannot be read.',
    }),
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

/** An env file's fingerprint: `sha256:` and the hex digest; null when it does not exist. */
const fileFingerprint = z.string().nullable();

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
    fingerprint: fileFingerprint.optional().meta({
      description:
        'Identifies the bytes read; a value edit names it. Null when the file does not exist; absent when its path was refused.',
    }),
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

// ---------------------------------------------------------------- writes

const variableName = z
  .string()
  .regex(VARIABLE_NAME)
  .meta({ description: 'A variable name, like `API_URL`.' });

const basedOn = fileFingerprint.meta({
  description:
    "The file's fingerprint the edit is based on, from GET /api/files; null when the file did not exist. A file that changed since is not written (409).",
});

const replaceProtected = z.array(variableName).optional().meta({
  description:
    'The protected keys the edit may replace or remove; any other protected change is refused.',
});

export const setValuesRequest = named(
  'SetValuesRequest',
  z
    .strictObject({
      file: z.string().min(1).meta({ description: 'A schema file path.' }),
      fingerprint: basedOn,
      values: z.record(variableName, z.string()).optional().meta({
        description: 'The values to set, by key, as a person would type them.',
      }),
      generate: z.array(variableName).optional().meta({
        description:
          'Secret string variables to set to a new random value, never returned.',
      }),
      replaceProtected,
    })
    .refine(
      (body) => Object.keys(body.values ?? {}).length || body.generate?.length,
      { message: 'set at least one value, or generate one' },
    )
    .refine(
      (body) =>
        !body.generate?.some((key) => Object.hasOwn(body.values ?? {}, key)),
      { message: 'a key is either given a value or generated, not both' },
    ),
);

export const unsetValuesRequest = named(
  'UnsetValuesRequest',
  z.strictObject({
    file: z.string().min(1).meta({ description: 'A schema file path.' }),
    fingerprint: basedOn,
    keys: z.array(variableName).min(1),
    replaceProtected,
  }),
);

export const KEY_STATUSES = [
  'updated',
  'added',
  'unchanged',
  'removed',
  'absent',
] as const;

export const valuesResponse = named(
  'ValuesEdit',
  z.object({
    file: z.string(),
    fingerprint: fileFingerprint.meta({
      description: "The file's fingerprint after the edit.",
    }),
    keys: z.array(z.object({ key: z.string(), status: z.enum(KEY_STATUSES) })),
    replaced: z
      .array(z.string())
      .meta({ description: 'The protected keys replaced.' }),
    generated: z
      .array(z.string())
      .meta({ description: 'The keys set to a generated value.' }),
    warnings: z.array(z.string()).meta({
      description:
        'What went wrong after the file was written: the protected state or the history not recorded.',
    }),
  }),
);

export const editProblem = named(
  'EditProblem',
  z.object({
    key: z.string().optional(),
    message: z.string(),
    reason: z.string().optional().meta({
      description: "A protected variable's reason, when it gives one.",
    }),
  }),
);

export const editRefusedResponse = named(
  'EditRefused',
  z.object({
    statusCode: z.literal(422),
    message: z.string(),
    kind: z.enum(['invalid', 'protected']).meta({
      description:
        'invalid: values that break their rules; protected: protected values the edit may not change.',
    }),
    errors: z.array(editProblem),
  }),
);

export const staleFileResponse = named(
  'StaleFile',
  z.object({
    statusCode: z.literal(409),
    message: z.string(),
    file: fileInfo.meta({ description: 'The file as it is now.' }),
  }),
);
