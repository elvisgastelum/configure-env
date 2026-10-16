// A sample project as the API reports it, for tests and stories: a merge
// `.env` with drift and a wrong mode, a generated example and a config file.

import type { SchemaDocument } from '@configure-env/core/schema';
import type {
  Change,
  Check,
  Files,
  Plan,
  Project,
  Schema,
  Validate,
  Variables,
} from '@configure-env/api-client';

export const project: Project = {
  root: '/home/ada/code/billing-service',
  schemaPath: 'env.schema.json',
  version: '0.4.0',
};

/**
 * The sample project's env.schema.json, as written: the variables and files
 * below, with their rules and per-file options.
 */
export const schemaDocument: SchemaDocument = {
  $schema:
    'https://raw.githubusercontent.com/elvisgastelum/configure-env/main/schema/env.schema.v1.json',
  version: 1,
  variables: {
    API_URL: {
      type: 'url',
      description: 'Where the API lives.',
      group: 'Network',
      required: true,
      comment: 'Without a trailing slash.',
      example: 'https://api.example.com',
      protocols: ['https'],
    },
    PORT: {
      type: 'port',
      description: 'The port the server listens on.',
      group: 'Network',
      default: 3000,
    },
    DB_PASSWORD: {
      type: 'string',
      description: 'The database password.',
      group: 'Database',
      required: true,
      secret: true,
      distinctFrom: 'API_KEY',
      protected: { reason: 'The database was created with it.' },
      minLength: 12,
    },
    API_KEY: {
      type: 'string',
      description: 'A key for the partner API.',
      secret: true,
      requiredUnless: ['DB_PASSWORD'],
    },
    LOG_LEVEL: {
      type: 'enum',
      values: ['debug', 'info'],
      default: 'info',
      comment: 'debug logs every request.',
    },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*', mode: '600' },
    {
      path: '.env.example',
      policy: 'generate',
      variables: ['API_URL', 'PORT', 'DB_PASSWORD'],
      header: 'Copy to .env and fill in the secrets.',
      values: { DB_PASSWORD: 'change-me' },
    },
    {
      path: 'config/app.env',
      policy: 'generate',
      variables: ['PORT', 'LOG_LEVEL'],
      comments: { LOG_LEVEL: 'Raise to info in production.' },
    },
  ],
};

export const schema: Schema = {
  path: 'env.schema.json',
  valid: true,
  document: schemaDocument,
  errors: [],
  fingerprint: 'schema-1',
};

/** More variables for the schema, one of each type the sample lacks. */
export const typedSchemaVariables: SchemaDocument['variables'] = {
  DEBUG: { type: 'boolean', group: 'App' },
  WORKERS: { type: 'integer', group: 'App', min: 1, max: 64 },
  RATIO: { type: 'number', group: 'App' },
  ADMIN_EMAIL: { type: 'email', group: 'App' },
  DB_HOST: { type: 'host', group: 'Database' },
  SERVICE_NETWORK: { type: 'cidr', group: 'Network', family: 'ipv4' },
  GATEWAY: { type: 'ipv4', group: 'Network', within: 'SERVICE_NETWORK' },
  NODE_ADDRESS: { type: 'ip', group: 'Network' },
  LINK_LOCAL: { type: 'ipv6', group: 'Network' },
};

export const missingSchema: Schema = {
  path: 'env.schema.json',
  valid: false,
  document: null,
  errors: [{ path: '(root)', message: 'cannot read env.schema.json: ENOENT' }],
};

export const invalidSchema: Schema = {
  path: 'env.schema.json',
  valid: false,
  document: { version: 2 },
  errors: [
    { path: 'version', message: 'must be 1', line: 2, column: 14 },
    { path: 'files[0].path', message: 'is required' },
  ],
};

export const variables: Variables = {
  variables: [
    {
      name: 'API_URL',
      spec: {
        type: 'url',
        required: true,
        secret: false,
        group: 'Network',
        description: 'Where the API lives.',
        comment: 'Without a trailing slash.',
        example: 'https://api.example.com',
        protocols: ['https'],
      },
      files: [
        {
          file: '.env',
          status: 'invalid',
          value: 'localhost:4000',
          error: 'is not a URL',
        },
        {
          file: '.env.example',
          status: 'set',
          value: 'https://api.example.com',
        },
      ],
    },
    {
      name: 'PORT',
      spec: {
        type: 'port',
        required: false,
        secret: false,
        group: 'Network',
        description: 'The port the server listens on.',
        default: 3000,
      },
      files: [
        { file: '.env', status: 'set', value: '8080' },
        { file: '.env.example', status: 'set', value: '3000' },
        { file: 'config/app.env', status: 'missing' },
      ],
    },
    {
      name: 'DB_PASSWORD',
      spec: {
        type: 'string',
        required: true,
        secret: true,
        group: 'Database',
        description: 'The database password.',
        distinctFrom: 'API_KEY',
        protected: { reason: 'The database was created with it.' },
        minLength: 12,
      },
      files: [
        { file: '.env', status: 'masked', value: '••••••••' },
        { file: '.env.example', status: 'missing' },
      ],
    },
    {
      name: 'API_KEY',
      spec: {
        type: 'string',
        required: false,
        secret: true,
        description: 'A key for the partner API.',
        requiredUnless: ['DB_PASSWORD'],
      },
      files: [{ file: '.env', status: 'missing' }],
    },
    {
      name: 'LOG_LEVEL',
      spec: {
        type: 'enum',
        values: ['debug', 'info'],
        required: false,
        secret: false,
        default: 'info',
        comment: 'debug logs every request.',
      },
      files: [
        { file: '.env', status: 'set', value: 'debug' },
        { file: 'config/app.env', status: 'missing' },
      ],
    },
  ],
};

export const files: Files = {
  files: [
    {
      path: '.env',
      policy: 'merge',
      template: false,
      exists: true,
      mode: { expected: '600', actual: '644' },
      drift: {
        status: 'missing-keys',
        drift: true,
        missingKeys: ['API_KEY'],
        unknownKeys: ['EXTRA'],
      },
      parseErrors: [{ line: 6, message: 'not a KEY=value line' }],
      fingerprint: 'env-1',
    },
    {
      path: '.env.example',
      policy: 'generate',
      template: true,
      exists: true,
      mode: { expected: null, actual: '644' },
      drift: {
        status: 'current',
        drift: false,
        missingKeys: [],
        unknownKeys: [],
      },
      parseErrors: [],
      fingerprint: 'example-1',
    },
    {
      path: 'config/app.env',
      policy: 'generate',
      template: false,
      exists: false,
      mode: { expected: null, actual: null },
      drift: {
        status: 'missing',
        drift: true,
        missingKeys: [],
        unknownKeys: [],
      },
      parseErrors: [],
      fingerprint: null,
    },
  ],
};

/**
 * Each existing file's lines as POST /api/files/content answers them:
 * secret values masked, line 6 of `.env` not an entry.
 */
export const fileLines: Record<string, string[]> = {
  '.env': [
    '# The billing service',
    'API_URL=localhost:4000',
    'PORT=8080',
    'DB_PASSWORD=••••••••',
    'LOG_LEVEL=debug  # every request',
    'this line is not an entry',
    'export EXTRA="1"',
  ],
  '.env.example': [
    '# Copy to .env and fill in the secrets.',
    'API_URL=https://api.example.com',
    'PORT=3000',
  ],
};

/** A plan with every action a file can take, for the preview. */
export const everyActionPlan: Plan = {
  fingerprint: 'plan-every-action',
  ok: true,
  errors: [],
  protected: [],
  files: [
    {
      path: 'config/app.env',
      policy: 'generate',
      action: 'create',
      addedKeys: ['PORT', 'LOG_LEVEL'],
      prunedKeys: [],
      mode: '644',
      currentMode: null,
      fingerprint: null,
      diff: [
        { kind: 'added', line: 'PORT=3000' },
        { kind: 'added', line: 'LOG_LEVEL=info' },
      ],
    },
    {
      path: '.env',
      policy: 'merge',
      action: 'update',
      addedKeys: ['API_KEY'],
      prunedKeys: [],
      mode: '600',
      currentMode: '600',
      fingerprint: 'env-1',
      diff: [
        { kind: 'same', line: 'PORT=8080' },
        { kind: 'removed', line: 'LOG_LEVEL=debug' },
        { kind: 'added', line: 'LOG_LEVEL=info' },
        { kind: 'added', line: 'API_KEY=••••••••' },
      ],
    },
    {
      path: '.env.local',
      policy: 'merge',
      action: 'mode',
      addedKeys: [],
      prunedKeys: [],
      mode: '600',
      currentMode: '644',
      fingerprint: 'local-1',
      diff: [{ kind: 'same', line: 'PORT=8080' }],
    },
    {
      path: '.env.example',
      policy: 'generate',
      action: 'unchanged',
      addedKeys: [],
      prunedKeys: [],
      mode: '644',
      currentMode: '644',
      fingerprint: 'example-1',
      diff: [{ kind: 'same', line: 'PORT=3000' }],
    },
    {
      path: '.env.seed',
      policy: 'create-only',
      action: 'skip',
      reason: 'exists',
      addedKeys: [],
      prunedKeys: [],
      mode: '644',
      currentMode: '644',
      fingerprint: 'seed-1',
      diff: [],
    },
  ],
};

export const check: Check = {
  ok: false,
  drift: true,
  files: [],
  errors: [{ kind: 'value', key: 'API_URL', message: 'is not a URL' }],
};

/** A drift report with every kind of item check gives, for the check page. */
export const driftCheck: Check = {
  ok: false,
  drift: true,
  errors: [
    { kind: 'value', key: 'LOG_LEVEL', message: 'must be one of debug, info' },
  ],
  files: [
    {
      path: '.env',
      policy: 'merge',
      status: 'missing-keys',
      drift: true,
      missingKeys: ['API_KEY'],
      unknownKeys: ['EXTRA'],
      invalid: [
        { key: 'API_URL', message: 'is not a URL', shown: 'localhost:4000' },
      ],
      rules: [
        {
          rule: 'distinctFrom',
          key: 'DB_PASSWORD',
          others: ['API_KEY'],
          message: 'must differ from API_KEY',
        },
      ],
      invalidLines: [6],
      protected: [
        {
          kind: 'protected',
          key: 'DB_PASSWORD',
          message: 'no longer matches the value the state recorded',
          reason: 'The database was created with it.',
        },
      ],
      mode: { actual: '644', expected: '600' },
    },
    {
      path: '.env.example',
      policy: 'generate',
      status: 'current',
      drift: false,
      missingKeys: [],
      unknownKeys: [],
      invalid: [],
      rules: [],
      invalidLines: [],
      protected: [],
    },
    {
      path: 'config/app.env',
      policy: 'generate',
      status: 'missing',
      drift: true,
      missingKeys: [],
      unknownKeys: [],
      invalid: [],
      rules: [],
      invalidLines: [],
      protected: [],
    },
  ],
};

export const validate: Validate = {
  ok: false,
  files: [
    {
      path: '.env',
      template: false,
      exists: true,
      ok: false,
      errors: [{ key: 'API_URL', message: 'is not a URL' }],
      warnings: [],
    },
  ],
};

/** A validate report with value, rule, protected and line errors. */
export const validationReport: Validate = {
  ok: false,
  files: [
    {
      path: '.env',
      template: false,
      exists: true,
      ok: false,
      errors: [
        { key: 'API_URL', message: 'is not a URL' },
        {
          key: 'DB_PASSWORD',
          keys: ['DB_PASSWORD', 'API_KEY'],
          message: 'must differ from API_KEY',
        },
        {
          kind: 'protected',
          key: 'DB_PASSWORD',
          message: 'no longer matches the value the state recorded',
          reason: 'The database was created with it.',
        },
        { line: 6, message: 'is not a valid entry' },
      ],
      warnings: [{ key: 'EXTRA', message: 'is not in the schema' }],
    },
    {
      path: '.env.example',
      template: true,
      exists: true,
      ok: true,
      errors: [],
      warnings: [],
    },
    {
      path: 'config/app.env',
      template: false,
      exists: true,
      ok: false,
      errors: [{ key: 'PORT', message: 'must be a port between 1 and 65535' }],
      warnings: [],
    },
  ],
};

export const passingCheck: Check = {
  ok: true,
  drift: false,
  files: [],
  errors: [],
};

export const passingValidate: Validate = { ok: true, files: [] };

/** A large schema: `count` string variables, a group per hundred. */
export function manyVariables(count: number): Variables['variables'] {
  return Array.from({ length: count }, (_, index) => {
    const name = `VAR_${String(index).padStart(4, '0')}`;
    return {
      name,
      spec: {
        type: 'string',
        required: false,
        secret: false,
        group: `Group ${Math.floor(index / 100) + 1}`,
        description: `Variable number ${index}.`,
      },
      files: [{ file: '.env', status: 'set', value: `value-${index}` }],
    };
  });
}

/**
 * The plain value POST /api/reveal answers for a masked secret: readable
 * and obviously fake, built from its file and key.
 */
export const secretValue = (file: string, key: string) =>
  `${key.toLowerCase()}-from-${file.replace(/^\./, '')}`;

/** More variables, one per editable type, all in `.env`. */
export const typedVariables: Variables['variables'] = [
  {
    name: 'DEBUG',
    spec: { type: 'boolean', required: false, secret: false, group: 'App' },
    files: [{ file: '.env', status: 'set', value: 'false' }],
  },
  {
    name: 'WORKERS',
    spec: {
      type: 'integer',
      required: false,
      secret: false,
      group: 'App',
      min: 1,
      max: 64,
    },
    files: [{ file: '.env', status: 'set', value: '4' }],
  },
  {
    name: 'RATIO',
    spec: { type: 'number', required: false, secret: false, group: 'App' },
    files: [{ file: '.env', status: 'set', value: '0.5' }],
  },
  {
    name: 'ADMIN_EMAIL',
    spec: { type: 'email', required: false, secret: false, group: 'App' },
    files: [{ file: '.env', status: 'set', value: 'ops@example.com' }],
  },
  {
    name: 'RELEASE_NAME',
    spec: { type: 'string', required: false, secret: false, group: 'App' },
    files: [{ file: '.env', status: 'set', value: 'blue' }],
  },
  {
    name: 'SESSION_KEY',
    spec: { type: 'string', required: false, secret: true, group: 'App' },
    files: [{ file: '.env', status: 'masked', value: '••••••••' }],
  },
];

/** Why a secret's change can't be undone, as the API says it. */
export const SECRET_UNDO_REASON =
  "the value is secret and is never stored, so this change can't be undone";

/** A schema document as the history keeps it: its text. */
export const schemaText = (document: unknown) =>
  `${JSON.stringify(document, null, 2)}\n`;

/** The sample schema before LOG_LEVEL was declared. */
const schemaBefore = {
  ...schemaDocument,
  variables: Object.fromEntries(
    Object.entries(schemaDocument.variables).filter(
      ([name]) => name !== 'LOG_LEVEL',
    ),
  ),
};

/**
 * The sample project's history, newest first: a schema edit, a portal
 * edit, a secret set from the CLI (which can't be undone) and a CLI edit.
 * Each change that can be undone matches the sample's values now.
 */
export const history: Change[] = [
  {
    id: 4,
    actor: 'portal',
    file: 'env.schema.json',
    key: '',
    operation: 'schema',
    at: '2026-10-15T14:30:00.000Z',
    secret: false,
    beforePreview: '4 variables, 3 files',
    afterPreview: '5 variables, 3 files',
    beforeValue: schemaText(schemaBefore),
    afterValue: schemaText(schemaDocument),
    restorable: true,
    undoOf: null,
  },
  {
    id: 3,
    actor: 'portal',
    file: '.env',
    key: 'LOG_LEVEL',
    operation: 'set',
    at: '2026-10-15T10:00:00.000Z',
    secret: false,
    beforePreview: 'info',
    afterPreview: 'debug',
    beforeValue: 'info',
    afterValue: 'debug',
    restorable: true,
    undoOf: null,
  },
  {
    id: 2,
    actor: 'cli',
    file: '.env',
    key: 'DB_PASSWORD',
    operation: 'set',
    at: '2026-10-14T09:05:00.000Z',
    secret: true,
    beforePreview: null,
    afterPreview: '••••',
    beforeValue: null,
    afterValue: null,
    restorable: false,
    undoBlocker: SECRET_UNDO_REASON,
    undoOf: null,
  },
  {
    id: 1,
    actor: 'cli',
    file: '.env',
    key: 'PORT',
    operation: 'set',
    at: '2026-10-14T09:00:00.000Z',
    secret: false,
    beforePreview: '3000',
    afterPreview: '8080',
    beforeValue: '3000',
    afterValue: '8080',
    restorable: true,
    undoOf: null,
  },
];
