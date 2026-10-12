import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app-providers';
import { consumeLaunchToken } from './lib/launch';
import { createAppRouter, createQueryClient } from './router';
import './styles.css';

// A token in the URL becomes the session cookie before the first request.
await consumeLaunchToken();

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
