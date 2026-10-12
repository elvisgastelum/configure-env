import { describe, expect, it } from 'vitest';
import { SCHEMA_ID, SCHEMA_VERSION } from '../schema/definition.ts';
import { inferSchema, inferType, inferVariables } from './infer.ts';

describe('inferType', () => {
  it.each([
    ['', { type: 'string' }],
    ['42', { type: 'integer', default: 42 }],
    ['9007199254740993', { type: 'string', default: '9007199254740993' }],
    ['1.5', { type: 'number', default: 1.5 }],
    ['true', { type: 'boolean', default: true }],
    ['a@b.co', { type: 'email', default: 'a@b.co' }],
    ['https://x.dev/a', { type: 'url', default: 'https://x.dev/a' }],
    ['10.0.0.1', { type: 'host', default: '10.0.0.1' }],
    ['hello', { type: 'string', default: 'hello' }],
  ])('reads %j', (value, expected) => {
    expect(inferType(value)).toEqual(expected);
  });
});

describe('inferVariables', () => {
  it('takes each key once, with the comment just above it', () => {
    const text = [
      '# The port.',
      '# Any free one.',
      'PORT=8080',
      '',
      'NAME=app',
      'PORT=9090',
      '# dangling',
      '',
    ].join('\n');
    expect(inferVariables(text)).toEqual({
      PORT: {
        type: 'integer',
        comment: 'The port.\nAny free one.',
        default: 8080,
      },
      NAME: { type: 'string', default: 'app' },
    });
  });
});

describe('inferSchema', () => {
  it('writes a valid document with one merge file', () => {
    expect(inferSchema('.env.example', 'PORT=8080\n')).toEqual({
      $schema: SCHEMA_ID,
      version: SCHEMA_VERSION,
      variables: { PORT: { type: 'integer', default: 8080 } },
      files: [{ path: '.env.example', policy: 'merge', variables: '*' }],
    });
  });

  it('starts empty without a source', () => {
    expect(inferSchema(undefined, '')).toMatchObject({
      variables: {},
      files: [],
    });
  });
});
