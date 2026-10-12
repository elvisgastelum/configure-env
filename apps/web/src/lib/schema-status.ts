import type { Schema } from '@configure-env/api-client';

export type SchemaStatus = 'valid' | 'invalid' | 'missing';

/**
 * `missing` when the schema file does not exist yet (the API could not read
 * it: ENOENT), `invalid` when it exists but is not a valid schema.
 */
export function schemaStatus(schema: Schema): SchemaStatus {
  if (schema.valid) return 'valid';
  const notFound =
    schema.document === null &&
    schema.errors.some((error) => error.message.endsWith(': ENOENT'));
  return notFound ? 'missing' : 'invalid';
}

/** The project's name: its root directory's last segment. */
export const projectName = (root: string) =>
  root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
