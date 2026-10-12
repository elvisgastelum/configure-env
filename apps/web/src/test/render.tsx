// Renders UI inside the portal's providers, as main.tsx does, or the whole
// app on a memory history at a given path.

import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '../app-providers';
import { createAppRouter, createQueryClient } from '../router';

export function renderWithProviders(ui: ReactNode) {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...render(<AppProviders queryClient={queryClient}>{ui}</AppProviders>),
  };
}

/** The app at `path`, once its route has loaded and rendered. */
export async function renderApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: [path] }),
  );
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  await act(() => router.load());
  // The palette loads in its own chunk right after the first paint.
  await act(async () => {
    await import('../components/command-menu');
  });
  return { router, queryClient, ...result };
}
