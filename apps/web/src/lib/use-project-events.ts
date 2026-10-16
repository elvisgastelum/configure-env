// Live state: GET /api/events streams a `changed` event naming the files
// that changed on disk. Every view refetches, and a toast notes a change
// made outside the portal. The portal's own writes change the files too;
// their events refresh quietly.

import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** How long after one of the portal's writes a change is taken as its own. */
export const OWN_WRITE_MS = 2_000;

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

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    // Any write the portal makes is a mutation: note when it last moved.
    let lastWrite = 0;
    const unsubscribe = queryClient
      .getMutationCache()
      .subscribe(() => (lastWrite = Date.now()));
    const source = new EventSource('/api/events');
    source.addEventListener('changed', (event) => {
      const paths = pathsOf((event as MessageEvent).data);
      void queryClient.invalidateQueries();
      const own =
        queryClient.isMutating() > 0 || Date.now() - lastWrite < OWN_WRITE_MS;
      if (own || paths.length === 0) return;
      toast.info(
        t('events.changed', { count: paths.length, paths: paths.join(', ') }),
        { id: 'external-change' },
      );
    });
    return () => {
      unsubscribe();
      source.close();
    };
  }, [queryClient, t]);
}
