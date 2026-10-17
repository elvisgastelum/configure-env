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
    change: z.int().optional().meta({
      description:
        'After a write: the id of the change it recorded in the history, which POST /api/history/{id}/undo takes.',
    }),
    warnings: z.array(z.string()).optional().meta({
      description:
        'After a write: what went wrong once the file was written, such as the history not recorded.',
    }),
    initFrom: z.string().optional().meta({
      description:
        'While the schema file is missing: the example env file POST /api/schema/init reads, when there is one (init may still refuse it, a symlink for one, and says why). Absent without one: init then writes an empty schema.',
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

export const fileContentRequest = named(
  'FileContentRequest',
  z.strictObject({
    file: z.string().min(1).meta({ description: 'A schema file path.' }),
  }),
);

export const fileContentResponse = named(
  'FileContent',
  z.object({
    file: z.string(),
    exists: z.boolean(),
    lines: z.array(z.string()).meta({
      description:
        'The lines as the file holds them, each secret value masked; empty when it does not exist.',
    }),
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

export const planError = named(
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
    kind: z.literal('protected').optional().meta({
      description:
        'protected: a protected value that no longer matches the one the state recorded.',
    }),
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    line: z.int().optional(),
    message: z.string(),
    reason: z.string().optional().meta({
      description: "A protected variable's reason, when it gives one.",
    }),
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
    changes: z.array(z.int()).meta({
      description:
        'The ids of the changes recorded in the history, one per changed key, which POST /api/history/{id}/undo takes; empty when the history was not recorded.',
    }),
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

const planInputs = {
  values: z.record(variableName, z.string()).optional().meta({
    description:
      'Values by key, as `apply --set` takes them; defaults fill the rest. Templates never take them.',
  }),
  files: z
    .array(z.string().min(1))
    .optional()
    .meta({ description: 'Only these schema files; every file when absent.' }),
  prune: z.boolean().optional().meta({
    description:
      'Remove the keys a merge or create-only file holds that the schema does not list for it.',
  }),
  replaceProtected,
};

export const planRequest = named('PlanRequest', z.strictObject(planInputs));

export const applyRequest = named(
  'ApplyRequest',
  z.strictObject({
    ...planInputs,
    fingerprint: z.string().min(1).meta({
      description:
        'The fingerprint of the plan shown, from POST /api/plan with the same inputs; a plan that differs now is not applied (409).',
    }),
  }),
);

const FILE_ACTIONS = ['create', 'update', 'mode', 'unchanged', 'skip'] as const;

const diffLine = named(
  'DiffLine',
  z.object({
    kind: z.enum(['same', 'added', 'removed']),
    line: z.string().meta({ description: 'The line, secrets masked.' }),
  }),
);

const filePlan = named(
  'FilePlan',
  z.object({
    path: z.string(),
    policy: z.enum(FILE_POLICIES),
    action: z.enum(FILE_ACTIONS).meta({
      description: 'mode: the content is current, only the permissions change.',
    }),
    reason: z.enum(['exists', 'refused', 'loosens']).optional().meta({
      description:
        'Why a file is skipped: create-only and present, an unsafe path, or a mode that would loosen it.',
    }),
    error: z.string().optional(),
    addedKeys: z.array(z.string()),
    prunedKeys: z.array(z.string()),
    mode: z
      .string()
      .meta({ description: 'The permissions it is written with, like `600`.' }),
    currentMode: z.string().nullable().meta({
      description: 'Its permissions now; null when it does not exist.',
    }),
    fingerprint: fileFingerprint.meta({
      description: "The file's fingerprint now; null when it does not exist.",
    }),
    diff: z.array(diffLine).meta({
      description:
        'From the file now to the file after; empty for a skipped one.',
    }),
  }),
);

const protectedRefusal = named(
  'ProtectedRefusal',
  z.object({
    file: z.string(),
    key: z.string(),
    message: z.string(),
    reason: z.string().optional(),
  }),
);

export const planResponse = named(
  'Plan',
  z.object({
    fingerprint: z.string().meta({
      description: 'Identifies this plan; POST /api/apply names it.',
    }),
    ok: z.boolean().meta({
      description:
        'Whether it can be applied: no error and no protected refusal.',
    }),
    files: z.array(filePlan),
    errors: z.array(planError),
    protected: z.array(protectedRefusal).meta({
      description:
        'Protected values the plan would change without replaceProtected naming them.',
    }),
  }),
);

export const planConflictResponse = named(
  'PlanConflict',
  z.object({
    statusCode: z.int().meta({ description: '409 or 422.' }),
    message: z.string(),
    plan: planResponse.meta({ description: 'The plan as it is now.' }),
  }),
);

export const applyResponse = named(
  'Applied',
  z.object({
    ok: z.boolean().meta({ description: 'Every file was written as planned.' }),
    files: z.array(
      z.object({
        path: z.string(),
        action: z.enum(FILE_ACTIONS),
        ok: z.boolean(),
        written: z.boolean(),
        error: z.string().optional(),
      }),
    ),
    replaced: z.array(z.object({ file: z.string(), key: z.string() })),
    warnings: z.array(z.string()),
  }),
);

// ---------------------------------------------------------------- schema writes

const schemaBasedOn = z.string().min(1).meta({
  description:
    "The schema's fingerprint the edit is based on, from GET /api/schema. A schema that changed since is not written (409).",
});

/** Fields the schema writer validates, so its errors carry JSON paths. */
const fields = (description: string) =>
  z.record(z.string(), z.unknown()).meta({ description });

export const addVariableRequest = named(
  'AddVariableRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    name: variableName,
    spec: fields('The variable, as env.schema.json writes it.'),
    files: z.array(z.string().min(1)).optional().meta({
      description:
        'Files whose variable list it joins; a file that takes `"*"` holds it already.',
    }),
  }),
);

export const updateVariableRequest = named(
  'UpdateVariableRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    changes: fields(
      'Fields to set; null removes one. A new `type` drops the options it does not take.',
    ),
  }),
);

export const removeVariableRequest = named(
  'RemoveVariableRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    cleanup: z.boolean().optional().meta({
      description:
        'Also remove every rule and file entry naming it; without it, a reference refuses the edit.',
    }),
  }),
);

export const renameVariableRequest = named(
  'RenameVariableRequest',
  z.strictObject({ fingerprint: schemaBasedOn, to: variableName }),
);

export const reorderVariablesRequest = named(
  'ReorderVariablesRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    order: z.array(z.string()).meta({
      description: 'Every declared variable, once, in its new place.',
    }),
  }),
);

export const addFileRequest = named(
  'AddFileRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    spec: fields('The file, as env.schema.json writes it.'),
    index: z
      .int()
      .min(0)
      .optional()
      .meta({ description: 'Where; last by default.' }),
  }),
);

export const updateFileRequest = named(
  'UpdateFileRequest',
  z.strictObject({
    fingerprint: schemaBasedOn,
    path: z.string().min(1),
    changes: fields(
      'Fields to set; null removes one; `path` renames the file.',
    ),
  }),
);

export const removeFileRequest = named(
  'RemoveFileRequest',
  z.strictObject({ fingerprint: schemaBasedOn, path: z.string().min(1) }),
);

export const initSchemaRequest = named(
  'InitSchemaRequest',
  z.strictObject({
    from: z.string().min(1).optional().meta({
      description:
        'The env file to infer the variables from, inside the root; `.env.example` when it exists, else none.',
    }),
    fingerprint: z.string().min(1).nullable().optional().meta({
      description:
        'To replace an existing schema, its fingerprint; without it an existing schema is kept (409).',
    }),
  }),
);

export const schemaEditRefusedResponse = named(
  'SchemaEditRefused',
  z.object({
    statusCode: z.literal(422),
    message: z.string(),
    errors: z.array(schemaError),
    schema: schemaResponse.meta({ description: 'The schema as it is now.' }),
  }),
);

export const staleSchemaResponse = named(
  'StaleSchema',
  z.object({
    statusCode: z.literal(409),
    message: z.string(),
    schema: schemaResponse.meta({ description: 'The schema as it is now.' }),
  }),
);

const CHANGE_ACTORS = ['cli', 'portal'] as const;
const CHANGE_OPERATIONS = ['set', 'unset', 'replace', 'schema'] as const;

export const historyChange = named(
  'Change',
  z.object({
    id: z.int(),
    actor: z.enum(CHANGE_ACTORS),
    file: z.string().meta({
      description:
        'The env file, or the schema file for a `schema` change, relative to the root.',
    }),
    key: z
      .string()
      .meta({ description: 'The variable; empty for a `schema` change.' }),
    operation: z.enum(CHANGE_OPERATIONS).meta({
      description:
        'set, unset, replace (a protected value replaced), or schema (the schema file written).',
    }),
    at: z.string().meta({ description: 'When, as an ISO timestamp.' }),
    secret: z.boolean().meta({
      description:
        'The variable is secret: its previews are masked and its values never stored.',
    }),
    beforePreview: z.string().nullable().meta({
      description:
        'The value before, cut short or masked for a secret; for the schema, how many variables and files it had. Null when there was none.',
    }),
    afterPreview: z.string().nullable(),
    beforeValue: z.string().nullable().meta({
      description:
        'The value before, or the schema text before; null for a secret, or when there was none.',
    }),
    afterValue: z.string().nullable(),
    restorable: z.boolean().meta({
      description: 'Whether POST /api/history/{id}/undo can undo it.',
    }),
    undoBlocker: z.string().optional().meta({
      description:
        "Why the change can't be undone, such as a secret's value never being stored; absent when it can.",
    }),
    undoOf: z
      .int()
      .nullable()
      .meta({ description: 'The change this one undid; null for an edit.' }),
  }),
);

export const historyQuery = z.object({
  file: z.string().min(1).optional(),
  key: z.string().optional().meta({
    description: 'A variable; empty for the schema changes.',
  }),
  actor: z.enum(CHANGE_ACTORS).optional(),
  from: z.iso
    .date()
    .or(z.iso.datetime({ offset: true }))
    .optional()
    .meta({ description: 'From this date (YYYY-MM-DD, UTC) or timestamp.' }),
  to: z.iso
    .date()
    .or(z.iso.datetime({ offset: true }))
    .optional()
    .meta({
      description:
        'Up to this date (its whole UTC day) or timestamp, included.',
    }),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const historyResponse = named(
  'History',
  z.object({
    changes: z.array(historyChange).meta({ description: 'Newest first.' }),
    total: z.int().meta({ description: 'How many changes match the filter.' }),
    page: z.int(),
    limit: z.int(),
  }),
);

export const undoResponse = named(
  'Undone',
  z.object({
    undone: historyChange.meta({ description: 'The change undone.' }),
    change: historyChange.optional().meta({
      description:
        'The change the undo recorded; absent when the history could not be written.',
    }),
    file: fileInfo.optional().meta({
      description: 'For a change to a value: the env file as it is now.',
    }),
    schema: schemaResponse.optional().meta({
      description: 'For a schema change: the schema as it is now.',
    }),
    warnings: z.array(z.string()).meta({
      description:
        'What went wrong after the file was written: the protected state or the history not recorded.',
    }),
  }),
);

export const undoConflictResponse = named(
  'UndoConflict',
  z.object({
    statusCode: z.literal(409),
    message: z.string().meta({
      description:
        'Why it was not undone: the file no longer holds what the change wrote (its fingerprint differs).',
    }),
    change: historyChange,
    file: fileInfo
      .optional()
      .meta({ description: 'For a change to a value: the file as it is now.' }),
    schema: schemaResponse
      .optional()
      .meta({ description: 'For a schema change: the schema as it is now.' }),
  }),
);

export const undoRefusedResponse = named(
  'UndoRefused',
  z.object({
    statusCode: z.literal(422),
    message: z.string(),
    kind: z.enum(['not-restorable', 'invalid', 'protected']).meta({
      description:
        "not-restorable: the change can't be undone (a secret's value is never stored); invalid: the previous value breaks the rules now; protected: it would change a protected value.",
    }),
    errors: z.array(editProblem),
    change: historyChange,
  }),
);

const position = z.int().min(1);

export const openInEditorRequest = named(
  'OpenInEditorRequest',
  z
    .strictObject({
      file: z.string().min(1).meta({
        description:
          'The schema file or one of its env files, relative to the root.',
      }),
      line: position.optional().meta({
        description: 'The 1-based line; it wins over `key` and `path`.',
      }),
      column: position
        .optional()
        .meta({ description: 'The 1-based column; 1 by default.' }),
      key: z.string().min(1).optional().meta({
        description:
          'A variable: its entry in an env file (the last one when it repeats), its definition in the schema file. The top of the file when it is not there.',
      }),
      path: z.string().min(1).optional().meta({
        description:
          'The schema file only: a JSON path as the schema errors give it, like `files[1].variables[0]`; the deepest part the file holds.',
      }),
    })
    .refine((body) => body.key === undefined || body.path === undefined, {
      message: 'pass a key or a path, not both',
    }),
);

export const openInEditorResponse = named(
  'OpenInEditor',
  z.object({
    opened: z.boolean().meta({
      description:
        'Whether the editor was started: true means it started and did not fail within 300 ms, not that it confirmed the file is open. A later failure is only written to the server log (stderr).',
    }),
    reason: z.enum(['no-editor', 'terminal-editor', 'failed']).optional().meta({
      description:
        'When not opened: no-editor: none is set or running; terminal-editor: the editor found runs only in a terminal, which the server has none of, so it is not started; failed: the editor command failed.',
    }),
    message: z.string().optional().meta({
      description: 'When not opened: what to tell the user.',
    }),
    file: z.string(),
    line: z.int(),
    column: z.int(),
  }),
);
