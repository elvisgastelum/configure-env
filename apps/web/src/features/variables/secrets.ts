// Secret values, unmasked one at a time. A revealed value lives only in the
// reveal context's state, never in the query or mutation cache, and it is
// masked again after REVEAL_TIMEOUT_MS.

import type { Variable } from '@configure-env/api-client';
import { revealValue } from '@configure-env/api-client';
import { createContext, useContext } from 'react';
import { unwrap } from '../../lib/api';

/** How long a revealed value stays visible. */
export const REVEAL_TIMEOUT_MS = 15_000;

/** The plain value of `key` in `file`, straight from the API; null when unset. */
export async function fetchPlainValue(
  file: string,
  key: string,
): Promise<string | null> {
  const revealed = await unwrap(revealValue({ file, key }));
  return revealed.value;
}

/** Whether a value has to be revealed: the API sends secrets masked. */
export const isMasked = (variable: Variable, file: string) =>
  variable.spec.secret &&
  variable.files.some(
    (entry) => entry.file === file && entry.value !== undefined,
  );

/**
 * The value as a person would read it: revealed through the API when it is
 * masked, as the API listed it otherwise. Undefined when it is not set.
 */
export async function plainValueOf(
  variable: Variable,
  file: string,
): Promise<string | undefined> {
  const entry = variable.files.find((value) => value.file === file);
  if (entry?.value === undefined) return undefined;
  if (!isMasked(variable, file)) return entry.value;
  return (await fetchPlainValue(file, variable.name)) ?? undefined;
}

export interface Revealed {
  file: string;
  key: string;
  value: string | null;
}

export interface RevealState {
  /** The one value shown unmasked, if any. */
  revealed?: Revealed;
  /** The value whose reveal is in flight. */
  pending?: { file: string; key: string };
  error?: { file: string; key: string; message: string };
  reveal: (file: string, key: string) => void;
  hide: () => void;
}

export const RevealContext = createContext<RevealState>({
  reveal: () => {},
  hide: () => {},
});

export const useReveal = () => useContext(RevealContext);
