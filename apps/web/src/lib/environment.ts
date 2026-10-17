// The environment the portal shows: `local`, the project of the server that
// serves it, or another one `configure-env env add` stored, reached through
// that server's gateway (`/env/<name>/api/*`). Every request follows it,
// through the api-client's base path, and stays same-origin with the
// session cookie: the browser never holds another server's token. The pick
// lasts for the tab (session storage), back to local in a new one.

import { environmentBasePath, setApiBasePath } from '@configure-env/api-client';
import { useSyncExternalStore } from 'react';

/** The name of the serving server's own project. */
export const LOCAL = 'local';

/** Where the tab keeps its pick. */
export const ENVIRONMENT_STORAGE_KEY = 'configure-env.environment';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function storedEnvironment(): string {
  try {
    const value = window.sessionStorage.getItem(ENVIRONMENT_STORAGE_KEY);
    return value && NAME.test(value) ? value : LOCAL;
  } catch {
    return LOCAL;
  }
}

let current = LOCAL;
const listeners = new Set<() => void>();

function apply(name: string) {
  current = name;
  setApiBasePath(environmentBasePath(name));
}

if (typeof window !== 'undefined') apply(storedEnvironment());

/** The environment the portal shows now. */
export const currentEnvironment = () => current;

/** Whether `name` is another server's project, not the serving one's. */
export const isRemote = (name: string) => name !== LOCAL;

/** Whether `name` is production, which the header sets apart. */
export const isProduction = (name: string) => /^prod(uction)?$/i.test(name);

/**
 * Shows `name` from now on: every request goes to it. The caller refetches
 * the views (see EnvironmentPicker).
 */
export function selectEnvironment(name: string): void {
  if (name !== LOCAL && !NAME.test(name))
    throw new Error(`not an environment name: ${name}`);
  if (name === current) return;
  apply(name);
  try {
    if (name === LOCAL)
      window.sessionStorage.removeItem(ENVIRONMENT_STORAGE_KEY);
    else window.sessionStorage.setItem(ENVIRONMENT_STORAGE_KEY, name);
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The environment the portal shows, re-rendering on a switch. */
export const useEnvironment = () =>
  useSyncExternalStore(subscribe, currentEnvironment, () => LOCAL);
