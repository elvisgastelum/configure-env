// The JSON Schema for env.schema.json, for editors and other tools: generated
// from the zod definition, so the two cannot disagree. Run
// `pnpm schema:generate` after changing definition.ts; a test fails while the
// committed copy is stale.
//
// JSON Schema cannot express the cross-field checks (defaults valid for their
// type, file variables declared, unique paths); only the loader runs those.

import { z } from 'zod';
import { SCHEMA_ID, envSchema } from './definition.ts';

/** Where the generated schema is committed, relative to the repo root. */
export const JSON_SCHEMA_PATH = 'schema/env.schema.v1.json';

/** The JSON Schema object, `$id` first after `$schema`. */
export function buildJsonSchema(): Record<string, unknown> {
  // `input`: fields with a default (like `required`) are optional to write.
  const generated = z.toJSONSchema(envSchema, {
    target: 'draft-2020-12',
    io: 'input',
  });
  const { $schema, title, description, ...rest } = generated;
  return { $schema, $id: SCHEMA_ID, title, description, ...rest };
}

/** The file content: 2-space JSON ending in a newline. */
export function renderJsonSchema(): string {
  return `${JSON.stringify(buildJsonSchema(), null, 2)}\n`;
}
