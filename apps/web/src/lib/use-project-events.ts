// Live state: GET /api/events streams a `changed` event naming the files
// that changed on disk. Every view refetches, and a toast notes a change
// made outside the portal. The portal's own writes change the files too;
// their events refresh quietly. A burst of events refetches once, and a
// reconnect refetches what changed while the stream was down. The stream is
// the shown environment's: switching reopens it under its base path.
//
// While another environment does not answer, the gateway's stream holds one
// `unreachable` event and ends, with a `retry:` hint: the portal says so
// (useEventsUnreachable) and EventSource keeps asking. A reopened stream
// that no `unreachable` event follows is the server back: the notice clears
// and the views refetch.

import { apiBasePath } from '@configure-env/api-client';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnvironment } from './environment';

/** How long after one of the portal's writes a change is taken as its own. */
export const OWN_WRITE_MS = 2_000;

/**
 * How long a burst of `changed` events (one save, a checkout) gathers before
 * the views refetch once.
 */
export const CHANGE_BURST_MS = 100;

/**
 * How long a reopened stream must go without an `unreachable` event before
 * the environment counts as answering again. The gateway sends that event
 * with the stream's headers, so it comes well within this.
 */
export const RECOVERED_AFTER_MS = 500;

/** Why the shown environment's events do not come, while they do not. */
let unreachable: string | undefined;
const unreachableListeners = new Set<() => void>();

function setUnreachable(message: string | undefined) {
  if (message === unreachable) return;
  unreachable = message;
  for (const listener of unreachableListeners) listener();
}

const subscribeUnreachable = (listener: () => void) => {
  unreachableListeners.add(listener);
  return () => unreachableListeners.delete(listener);
};

/**
 * The gateway's message while the shown environment does not answer and its
 * events retry; undefined while they come.
 */
export const useEventsUnreachable = () =>
  useSyncExternalStore(
    subscribeUnreachable,
    () => unreachable,
    () => undefined,
  );

/** The message of an `unreachable` event; a plain one when it is malformed. */
function messageOf(data: unknown): string {
  try {
    const parsed = JSON.parse(String(data)) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON: the plain message below.
  }
  return 'unreachable';
}

/** The paths a `changed` event names; none when it is malformed. */
function pathsOf(data: unknown): string[] {
  try {
    const parsed = JSON.parse(String(data)) as { paths?: unknown };
    return Array.isArray(parsed.paths)
      ? parsed.paths.filter((path): path is string => typeof path === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Listens for changes on disk while the portal is open. */
export function useProjectEvents() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const environment = useEnvironment();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    // A write the portal makes is a mutation starting or settling. An
    // observer joining, or the cache dropping a finished one, writes nothing.
    let lastWrite = 0;
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'added' && event.type !== 'updated') return;
      const { status } = event.mutation.state;
      if (status === 'pending' || status === 'success') lastWrite = Date.now();
    });
    const own = () =>
      queryClient.isMutating() > 0 || Date.now() - lastWrite < OWN_WRITE_MS;

    // A burst refetches once, and says once what changed outside the portal.
    let burst: ReturnType<typeof setTimeout> | undefined;
    const outside = new Set<string>();
    const flush = () => {
      burst = undefined;
      const paths = [...outside];
      outside.clear();
      void queryClient.invalidateQueries();
      if (paths.length === 0) return;
      toast.info(
        t('events.changed', { count: paths.length, paths: paths.join(', ') }),
        { id: 'external-change' },
      );
    };

    const source = new EventSource(`${apiBasePath()}/api/events`);
    // An open after the first is a reconnect: what changed while the stream
    // was down sent no event, so the views refetch, quietly.
    let opened = false;
    // While the environment does not answer, an open is only a retry until
    // RECOVERED_AFTER_MS pass without another `unreachable` event.
    let down = false;
    let recovering: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener('open', () => {
      if (down) {
        clearTimeout(recovering);
        recovering = setTimeout(() => {
          down = false;
          setUnreachable(undefined);
          void queryClient.invalidateQueries();
        }, RECOVERED_AFTER_MS);
        return;
      }
      if (opened) void queryClient.invalidateQueries();
      opened = true;
    });
    source.addEventListener('unreachable', (event) => {
      clearTimeout(recovering);
      opened = true;
      down = true;
      setUnreachable(messageOf((event as MessageEvent).data));
    });
    source.addEventListener('changed', (event) => {
      if (!own())
        for (const path of pathsOf((event as MessageEvent).data))
          outside.add(path);
      clearTimeout(burst);
      burst = setTimeout(flush, CHANGE_BURST_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(burst);
      clearTimeout(recovering);
      source.close();
      setUnreachable(undefined);
    };
  }, [queryClient, t, environment]);
}
