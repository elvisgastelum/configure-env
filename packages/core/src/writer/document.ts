// The schema as the writer edits it: the JSON document as written, before
// parsing fills in defaults, so an edit writes back only what it changed.

import type { z } from 'zod';
import {
  type EnvSchema,
  type envSchema,
  type fileSpec,
  type variableSpec,
} from '../schema/definition.ts';
import { type SchemaError, parseSchema } from '../schema/parse.ts';

/** `env.schema.json` as written: optional fields may be absent. */
export type SchemaDocument = z.input<typeof envSchema>;

/** One variable as written. */
export type VariableInput = z.input<typeof variableSpec>;

/** One file as written. */
export type FileInput = z.input<typeof fileSpec>;

/** An edit's outcome: the new document and its parsed schema, or why not. */
export type SchemaEditResult =
  | { ok: true; document: SchemaDocument; schema: EnvSchema }
  | { ok: false; errors: SchemaError[] };

/** Validates an edited document with every check `parseSchema` makes. */
export function validateDocument(document: SchemaDocument): SchemaEditResult {
  const result = parseSchema(document);
  return result.ok
    ? { ok: true, document, schema: result.schema }
    : { ok: false, errors: result.errors };
}
