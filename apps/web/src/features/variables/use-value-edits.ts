// Value writes through the API: set (given or generated) and unset one key
// of one file. Each write names the fingerprint of the file it was based on
// (from GET /api/files), so a file that changed since answers 409.

import {
  type EditRefused,
  type FileValue,
  type Files,
  type StaleFile,
  type Variables,
  type ValuesEdit,
  planChanges,
  setValues,
  unsetValues,
} from '@configure-env/api-client';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ApiRequestError,
  checkQuery,
  filesQuery,
  unwrap,
  variablesQuery,
} from '../../lib/api';

/** One write to one key of one file. */
export type ValueEdit =
  | { kind: 'set'; file: string; key: string; value: string }
  | { kind: 'generate'; file: string; key: string }
  | { kind: 'unset'; file: string; key: string };

export interface EditOptions {
  /** Replace a protected value on purpose. */
  replaceProtected?: boolean;
  /** The fingerprint to write on top of; the last read one when absent. */
  fingerprint?: string | null;
}

export type EditRequest = ValueEdit & EditOptions;

/** The fingerprint of `file` the portal last read; null when it is new. */
export function knownFingerprint(queryClient: QueryClient, file: string) {
  const files = queryClient.getQueryData<Files>(filesQuery.queryKey);
  return files?.files.find((info) => info.path === file)?.fingerprint ?? null;
}

function send(request: EditRequest, fingerprint: string | null) {
  const { file, key } = request;
  const replaceProtected = request.replaceProtected ? [key] : undefined;
  const common = {
    file,
    fingerprint,
    ...(replaceProtected ? { replaceProtected } : {}),
  };
  switch (request.kind) {
    case 'set':
      return unwrap(setValues({ ...common, values: { [key]: request.value } }));
    case 'generate':
      return unwrap(setValues({ ...common, generate: [key] }));
    case 'unset':
      return unwrap(unsetValues({ ...common, keys: [key] }));
  }
}

/** Every read a value write can change. */
export async function refreshAfterEdit(queryClient: QueryClient) {
  await Promise.all(
    [variablesQuery, filesQuery, checkQuery].map((query) =>
      queryClient.invalidateQueries({ queryKey: query.queryKey }),
    ),
  );
}

const MASK = '••••••••';

/** `variables` as they will be once `edit` is written, to show it at once. */
export function applyEdit(variables: Variables, edit: ValueEdit): Variables {
  return {
    variables: variables.variables.map((variable) => {
      if (variable.name !== edit.key) return variable;
      const masked = variable.spec.secret;
      return {
        ...variable,
        files: variable.files.map((value): FileValue => {
          if (value.file !== edit.file) return value;
          switch (edit.kind) {
            case 'set':
              return {
                file: value.file,
                status: masked ? 'masked' : 'set',
                value: masked ? MASK : edit.value,
              };
            case 'generate':
              return { file: value.file, status: 'masked', value: MASK };
            case 'unset':
              return { file: value.file, status: 'missing' };
          }
        }),
      };
    }),
  };
}

/** The 409 of a write: the file changed since the portal read it. */
export function staleFile(error: unknown): StaleFile | undefined {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return;
  return error.body as StaleFile;
}

/**
 * Writes one value. The table and the drawer show the new value at once
 * and get the old one back if the write fails; every read the write can
 * change is fetched again after.
 */
export function useValueEdit() {
  const queryClient = useQueryClient();
  const { queryKey } = variablesQuery;
  return useMutation<ValuesEdit, Error, EditRequest, { before?: Variables }>({
    mutationFn: (request) =>
      send(
        request,
        request.fingerprint !== undefined
          ? request.fingerprint
          : knownFingerprint(queryClient, request.file),
      ),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData<Variables>(queryKey);
      if (before)
        queryClient.setQueryData(queryKey, applyEdit(before, request));
      return { before };
    },
    onError: (_error, _request, context) => {
      if (context?.before) queryClient.setQueryData(queryKey, context.before);
    },
    onSettled: () => refreshAfterEdit(queryClient),
  });
}

/** The messages of a refused edit (422), one per problem. */
export function refusalMessages(error: unknown): EditRefused['errors'] {
  if (!(error instanceof ApiRequestError) || error.status !== 422) return [];
  const body = error.body as Partial<EditRefused> | undefined;
  return body?.errors ?? [];
}

/** `value`, once it has stopped changing for `delay` ms. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** How long a draft rests before it is checked. */
const CHECK_DELAY_MS = 250;

/**
 * The core's messages about `draft` as the value of `key` in `file`: its
 * own rules and the rules between variables. The API checks it in a dry run
 * (POST /api/plan writes nothing), as the core cannot run in a browser.
 * Undefined while the draft is unchecked.
 */
export function useDraftProblems(
  file: string,
  key: string,
  draft: string,
  enabled: boolean,
): string[] | undefined {
  const settled = useSettled(draft, CHECK_DELAY_MS);
  const check = useQuery({
    queryKey: ['draft-problems', file, key, settled],
    queryFn: ({ signal }) =>
      unwrap(
        planChanges({ values: { [key]: settled }, files: [file] }, { signal }),
      ),
    enabled: enabled && settled === draft,
    // A draft may be a secret: keep no answer about it once it is gone.
    gcTime: 0,
    staleTime: 0,
  });
  if (!enabled) return [];
  if (settled !== draft || !check.data) return undefined;
  return check.data.errors
    .filter((error) => error.key === key || error.keys?.includes(key))
    .map((error) => error.message);
}
