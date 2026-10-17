// The portal's queries over the generated client. The generated fetch
// functions resolve on every status; `unwrap` turns anything but a 200 into
// an ApiRequestError, so React Query sees a failure as an error.

import {
  getCheck,
  getFiles,
  getGroups,
  getGetCheckQueryKey,
  getGetFilesQueryKey,
  getGetGroupsQueryKey,
  getGetProjectQueryKey,
  getGetSchemaQueryKey,
  getGetValidateQueryKey,
  getGetVariablesQueryKey,
  getProject,
  getSchema,
  getValidate,
  getVariables,
  readFileContent,
} from '@configure-env/api-client';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The error's body, as the API sent it (a 409 holds the file now). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The body of a 200, or an ApiRequestError with the API's message. */
export async function unwrap<R extends { status: number; data: unknown }>(
  response: Promise<R>,
): Promise<Extract<R, { status: 200 }>['data']> {
  const { status, data } = await response;
  if (status === 200) return data as Extract<R, { status: 200 }>['data'];
  const message =
    typeof data === 'object' && data !== null && 'message' in data
      ? String(data.message)
      : `request failed with ${status}`;
  throw new ApiRequestError(status, message, data);
}

/** Whether the server refused the session: the cookie is missing or stale. */
export const isUnauthorized = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 401;

export const projectQuery = queryOptions({
  queryKey: getGetProjectQueryKey(),
  queryFn: ({ signal }) => unwrap(getProject({ signal })),
  staleTime: Infinity,
});

export const schemaQuery = queryOptions({
  queryKey: getGetSchemaQueryKey(),
  queryFn: ({ signal }) => unwrap(getSchema({ signal })),
  // Structural sharing keeps an old object when only its key order changed,
  // and the order of `variables` is the schema's declaration order.
  structuralSharing: false,
});

export const variablesQuery = queryOptions({
  queryKey: getGetVariablesQueryKey(),
  queryFn: ({ signal }) => unwrap(getVariables({ signal })),
});

export const groupsQuery = queryOptions({
  queryKey: getGetGroupsQueryKey(),
  queryFn: ({ signal }) => unwrap(getGroups({ signal })),
});

export const filesQuery = queryOptions({
  queryKey: getGetFilesQueryKey(),
  queryFn: ({ signal }) => unwrap(getFiles({ signal })),
});

export const checkQuery = queryOptions({
  queryKey: getGetCheckQueryKey(),
  queryFn: ({ signal }) => unwrap(getCheck(undefined, { signal })),
});

export const validateQuery = queryOptions({
  queryKey: getGetValidateQueryKey(),
  queryFn: ({ signal }) => unwrap(getValidate(undefined, { signal })),
});

/**
 * One file's lines, secrets masked, for its raw view. Under `files`, so a
 * write that refreshes the files refreshes it too.
 */
export const fileContentQuery = (file: string) =>
  queryOptions({
    queryKey: [...getGetFilesQueryKey(), 'content', file],
    queryFn: ({ signal }) => unwrap(readFileContent({ file }, { signal })),
  });

/** Every read a schema write can change, besides the schema itself. */
export async function refreshAfterSchemaWrite(queryClient: QueryClient) {
  await Promise.all(
    [variablesQuery, groupsQuery, filesQuery, checkQuery, validateQuery].map(
      (query) => queryClient.invalidateQueries({ queryKey: query.queryKey }),
    ),
  );
}
