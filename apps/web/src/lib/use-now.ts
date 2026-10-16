// The current time, renewed every minute, so relative dates ("5 minutes
// ago") move on while a page stays open. One timer serves every reader,
// and it runs only while something reads it.

import { useSyncExternalStore } from 'react';

export const NOW_INTERVAL_MS = 60_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, NOW_INTERVAL_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/** Now, as a Date that changes once a minute. */
export function useNow(): Date {
  return new Date(
    useSyncExternalStore(
      subscribe,
      () => now,
      () => now,
    ),
  );
}
