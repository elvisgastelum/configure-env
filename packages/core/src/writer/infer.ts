// Infers a starting schema from an existing env file: each key's type from
// its value, its comment from the comment lines just above it, and its
// default from the value. `configure-env init` and the API's init share it.

import { isIPv4 } from 'node:net';
import { z } from 'zod';
import { parseDotenv } from '../engine/dotenv.ts';
import {
  SCHEMA_ID,
  SCHEMA_VERSION,
  type VariableType,
} from '../schema/definition.ts';
import type { SchemaDocument } from './document.ts';

/** The example env file init reads when none is named, if it exists. */
export const DEFAULT_EXAMPLE = '.env.example';

/** A variable as init writes it into the schema. */
export interface InferredVariable {
  type: VariableType;
  comment?: string;
  default?: string | number | boolean;
}

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?[eE][+-]?\d+)$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const email = z.email();

/** The type a value reads as, and the value typed for `default`. */
export function inferType(value: string): Omit<InferredVariable, 'comment'> {
  if (value === '') return { type: 'string' };
  if (INTEGER.test(value)) {
    const number = Number(value);
    // A whole number past 2^53 would lose digits as a JSON number.
    return Number.isSafeInteger(number)
      ? { type: 'integer', default: number }
      : { type: 'string', default: value };
  }
  if (DECIMAL.test(value) && Number.isFinite(Number(value)))
    return { type: 'number', default: Number(value) };
  if (value === 'true' || value === 'false')
    return { type: 'boolean', default: value === 'true' };
  if (email.safeParse(value).success) return { type: 'email', default: value };
  if (SCHEME.test(value) && URL.canParse(value))
    return { type: 'url', default: value };
  if (isIPv4(value)) return { type: 'host', default: value };
  return { type: 'string', default: value };
}

const COMMENT = /^\s*#\s?/;

/** The variables of an env file's text, in the order their keys first appear. */
export function inferVariables(text: string): Record<string, InferredVariable> {
  const variables: Record<string, InferredVariable> = {};
  let comments: string[] = [];
  for (const line of parseDotenv(text).lines) {
    if (line.kind === 'comment') {
      comments.push(line.raw.replace(COMMENT, '').trimEnd());
      continue;
    }
    if (line.kind === 'entry' && !(line.key! in variables)) {
      const comment = comments.join('\n');
      const { type, default: value } = inferType(line.value ?? '');
      variables[line.key!] = {
        type,
        ...(comment ? { comment } : {}),
        ...(value === undefined ? {} : { default: value }),
      };
    }
    comments = [];
  }
  return variables;
}

/**
 * The starting schema document: the variables of `text`, and `from` as its
 * one merge file; empty without a source.
 */
export function inferSchema(
  from: string | undefined,
  text: string,
): SchemaDocument {
  return {
    $schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    variables: from ? inferVariables(text) : {},
    files: from ? [{ path: from, policy: 'merge', variables: '*' }] : [],
  } as SchemaDocument;
}
