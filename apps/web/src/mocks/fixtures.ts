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
