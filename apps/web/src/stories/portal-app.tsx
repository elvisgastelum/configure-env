import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createAppRouter } from '../router';

/** The whole portal at `path`, on a memory history, for stories. */
export function PortalApp({ path = '/' }: { path?: string }) {
  const queryClient = useQueryClient();
  const [router] = useState(() =>
    createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: [path] }),
    ),
  );
  return <RouterProvider router={router} />;
}
