// Renders UI inside the portal's providers, as main.tsx does.

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '../app-providers';
import { createQueryClient } from '../router';

export function renderWithProviders(ui: ReactNode) {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...render(<AppProviders queryClient={queryClient}>{ui}</AppProviders>),
  };
}
