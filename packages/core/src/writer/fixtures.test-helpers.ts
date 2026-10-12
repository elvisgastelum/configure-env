// Shared by the writer tests: a base document, a variable of every type with
// every option it takes, and helpers to unwrap edit results.

import { expect } from 'vitest';
import { VARIABLE_TYPES, type VariableType } from '../schema/definition.ts';
import type {
  SchemaDocument,
  SchemaEditResult,
  VariableInput,
} from './document.ts';

/** Two variables to point rules at, and a generated and a template file. */
export const baseDocument = (): SchemaDocument => ({
  $schema: 'https://example.com/env.schema.v1.json',
  version: 1,
  variables: {
    NET: { type: 'cidr' },
    OTHER: { type: 'string' },
  },
  files: [
    { path: '.env', policy: 'generate', variables: '*' },
    {
      path: '.env.example',
      policy: 'generate',
      variables: ['OTHER'],
      values: { OTHER: 'placeholder' },
    },
  ],
});

/** The fields every type shares, each set, pointing rules at OTHER. */
const common = {
  description: 'What it is for',
  group: 'Group',
  required: false,
  secret: true,
  allowEmpty: false,
  comment: 'A comment.\nTwo lines.',
  requiredUnless: 'OTHER',
  conflictsWith: ['OTHER'],
  distinctFrom: 'OTHER',
  protected: { reason: 'Rotating it breaks sessions' },
};

/** One variable of every type, with every option its type takes. */
export const FULL: Record<VariableType, VariableInput> = {
  string: {
    type: 'string',
    ...common,
    default: 'abcd',
    example: '0a0b',
    minLength: 4,
    maxLength: 4,
    pattern: '^[0-9a-f]+$',
    patternMessage: 'lowercase hex',
    encoding: 'hex',
    bytes: 2,
  },
  number: {
    type: 'number',
    ...common,
    default: 1.5,
    example: 2,
    min: 0,
    max: 10,
  },
  integer: {
    type: 'integer',
    ...common,
    default: 1,
    example: 2,
    min: 0,
    max: 10,
  },
  boolean: { type: 'boolean', ...common, default: true, example: false },
  enum: {
    type: 'enum',
    ...common,
    values: ['a', 'b'],
    default: 'a',
    example: 'b',
  },
  email: {
    type: 'email',
    ...common,
    default: 'a@example.com',
    example: 'b@example.com',
  },
  url: {
    type: 'url',
    ...common,
    protocols: ['https'],
    default: 'https://example.com',
    example: 'https://example.org',
  },
  host: {
    type: 'host',
    ...common,
    default: 'example.com',
    example: '10.0.0.1',
  },
  ipv4: {
    type: 'ipv4',
    ...common,
    default: '10.0.0.1',
    example: '10.0.0.2',
    within: 'NET',
  },
  ipv6: {
    type: 'ipv6',
    ...common,
    default: 'fd00::1',
    example: 'fd00::2',
    within: 'NET',
  },
  ip: {
    type: 'ip',
    ...common,
    default: '10.0.0.1',
    example: '::1',
    within: 'NET',
  },
  cidr: {
    type: 'cidr',
    ...common,
    default: '10.1.0.0/16',
    example: '10.2.0.0/16',
    within: 'NET',
    family: 'ipv4',
    strict: true,
  },
  port: { type: 'port', ...common, default: 8080, example: 443 },
};

export const TYPES = VARIABLE_TYPES;

/** The edited document, failing the test when the edit was refused. */
export function edited(result: SchemaEditResult): SchemaDocument {
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.document;
}

/** The refused edit's errors, failing the test when it went through. */
export function refused(result: SchemaEditResult) {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}
