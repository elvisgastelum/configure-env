// The refusals the writer's edits share; internal to the writer.

import { formatIssuePath } from '../schema/load.ts';
import type { SchemaEditResult } from './document.ts';

/** An edit refused with one error at `path`. */
export const refuse = (
  path: readonly PropertyKey[],
  message: string,
): SchemaEditResult => ({
  ok: false,
  errors: [{ path: formatIssuePath(path), message }],
});

/** An edit of a variable the document does not declare. */
export const notDeclared = (name: string) =>
  refuse(['variables', name], `${name} is not declared`);
