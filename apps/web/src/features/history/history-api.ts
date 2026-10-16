// The history of edits through the API: a filtered page of changes, and
// undoing changes. An undo runs as a mutation of the query cache, so the
// live updates take the files it writes as the portal's own.

import {
  type GetHistoryParams,
  type UndoConflict,
  type UndoRefused,
  type Undone,
  getGetHistoryQueryKey,
  getHistory,
  undoChange,
} from '@configure-env/api-client';
import {
  type QueryClient,
  keepPreviousData,
  queryOptions,
} from '@tanstack/react-query';
import { ApiRequestError, unwrap } from '../../lib/api';

/** The changes a page of the history holds. */
export const HISTORY_LIMIT = 20;

/** A page of the history; the previous page shows while the next loads. */
export const historyQuery = (params: GetHistoryParams = {}) =>
  queryOptions({
    queryKey: getGetHistoryQueryKey(params),
    queryFn: ({ signal }) => unwrap(getHistory(params, { signal })),
    placeholderData: keepPreviousData,
  });

/**
 * Undoes `ids`, the latest first, so a write of several changes goes back
 * whole; resolves to the last answer. Every read is fetched again after,
 * whatever the outcome: an undo may have written before one was refused.
 */
export async function undoChanges(
  queryClient: QueryClient,
  ids: readonly number[],
): Promise<Undone> {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: ['undo', ...ids],
    mutationFn: async () => {
      let last: Undone | undefined;
      for (const id of [...ids].sort((a, b) => b - a))
        last = await unwrap(undoChange(id));
      return last!;
    },
  });
  try {
    return await mutation.execute(undefined);
  } finally {
    await queryClient.invalidateQueries();
  }
}

/** The 409 of an undo: the file no longer holds what the change wrote. */
export function undoConflict(error: unknown): UndoConflict | undefined {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return;
  return error.body as UndoConflict;
}

/** The 422 of an undo: a change that can't be undone, or a refused write. */
export function undoRefused(error: unknown): UndoRefused | undefined {
  if (!(error instanceof ApiRequestError) || error.status !== 422) return;
  return error.body as UndoRefused;
}

/** Why an undo failed, in the API's words. */
export function undoFailure(error: unknown): string {
  const refused = undoRefused(error);
  const details = refused?.errors
    .map((problem) =>
      problem.key ? `${problem.key}: ${problem.message}` : problem.message,
    )
    .filter((message) => message !== refused.message);
  return details?.length
    ? `${refused!.message} (${details.join('; ')})`
    : error instanceof Error
      ? error.message
      : String(error);
}
