// A sample project as the API reports it, for tests and stories: a merge
// `.env` with drift and a wrong mode, a generated example and a config file.

import type {
  Check,
  Files,
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

export const schema: Schema = {
  path: 'env.schema.json',
  valid: true,
  document: { version: 1 },
  errors: [],
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
      },
      files: [{ file: '.env', status: 'invalid', error: 'is not a URL' }],
    },
    {
      name: 'PORT',
      spec: {
        type: 'port',
        required: false,
        secret: false,
        group: 'Network',
        default: 3000,
      },
      files: [{ file: '.env', status: 'set', value: '8080' }],
    },
    {
      name: 'DB_PASSWORD',
      spec: { type: 'string', required: true, secret: true, group: 'Database' },
      files: [{ file: '.env', status: 'masked', value: '••••••••' }],
    },
    {
      name: 'API_KEY',
      spec: { type: 'string', required: false, secret: true },
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
      },
      files: [{ file: '.env', status: 'set', value: 'debug' }],
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
    },
  ],
};

export const check: Check = {
  ok: false,
  drift: true,
  files: [],
  errors: [{ kind: 'value', key: 'API_URL', message: 'is not a URL' }],
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

export const passingCheck: Check = {
  ok: true,
  drift: false,
  files: [],
  errors: [],
};

export const passingValidate: Validate = { ok: true, files: [] };
