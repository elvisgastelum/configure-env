import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { emitChanged, eventClients } from '../mocks/store';

/**
 * Sends a `changed` event naming `paths` once the portal listens on
 * GET /api/events, as the API does after a change on disk.
 */
export async function changeOutside(paths: string[]) {
  await waitFor(() => expect(eventClients.size).toBeGreaterThan(0));
  emitChanged(paths);
}
