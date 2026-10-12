// The protected variables' state the API reads: from the project's state
// database, only when the schema protects anything.

import {
  type EnvSchema,
  type State,
  loadState,
  protectsAny,
} from '@configure-env/core';
import { ApiError } from './http.ts';
import type { Project } from './project.ts';

/**
 * The state when the schema protects a variable; undefined when it protects
 * none. A state that cannot be read answers 503: nothing that needs it can
 * be decided without it.
 */
export async function protectedState(
  schema: EnvSchema,
  project: Project,
): Promise<State | undefined> {
  if (!protectsAny(schema)) return undefined;
  const result = await loadState(project.statePath);
  if (!result.ok) throw new ApiError(503, `invalid state ${result.message}`);
  return result.state;
}
