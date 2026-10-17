// Live state: GET /api/events streams a `changed` event naming the files
// that changed on disk. Every view refetches, and a toast notes a change
// made outside the portal. The portal's own writes change the files too;
// their events refresh quietly. A burst of events refetches once, and a
// reconnect refetches what changed while the stream was down. The stream is
// the shown environment's: switching reopens it under its base path.

import { apiBasePath } from '@configure-env/api-client';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnvironment } from './environment';

/** How long after one of the portal's writes a change is taken as its own. */
export const OWN_WRITE_MS = 2_000;

/**
 * How long a burst of `changed` events (one save, a checkout) gathers before
 * the views refetch once.
 */
export const CHANGE_BURST_MS = 100;

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
    source.addEventListener('open', () => {
      if (opened) void queryClient.invalidateQueries();
      opened = true;
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
      source.close();
    };
  }, [queryClient, t, environment]);
}
