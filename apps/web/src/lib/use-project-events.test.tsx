import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { scenarios } from '../mocks/handlers';
import {
  dropEvents,
  emitChanged,
  eventClients,
  mockState,
  writeValue,
} from '../mocks/store';
import { changeOutside } from '../test/events';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import { OWN_WRITE_MS } from './use-project-events';

const toastFor = (paths: string) =>
  screen.findByText(
    `${paths} changed outside the portal; the views show it now.`,
  );

/** The region of `.env` as the page shows it now. */
const envRegion = () => screen.getByRole('region', { name: '.env' });

/** The variables table row of `name` as the page shows it now. */
const variableRow = (name: string) => {
  const row = document.querySelector(`[data-variable="${name}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

/** How many GET requests reach `path` from now on. */
function countReads(path: string) {
  const reads = { count: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET' && new URL(request.url).pathname === path)
      reads.count += 1;
  });
  return reads;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('external changes', () => {
  it('refresh the check report', async () => {
    server.use(...scenarios.liveReports);
    await renderApp('/check');
    expect(
      await screen.findByRole('region', { name: '.env' }),
    ).toHaveTextContent('API_KEY is missing');

    writeValue('.env', 'API_KEY', ['outside', String(Date.now())].join('-'));
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
    await waitFor(() =>
      expect(envRegion()).not.toHaveTextContent('API_KEY is missing'),
    );
  });

  it('refresh the validate report', async () => {
    server.use(...scenarios.liveReports);
    await renderApp('/validate');
    const env = await screen.findByRole('region', { name: '.env' });
    expect(
      within(env).getByRole('region', { name: 'API_URL' }),
    ).toBeInTheDocument();

    writeValue('.env', 'API_URL', 'https://api.example.com');
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(envRegion()).queryByRole('region', { name: 'API_URL' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('refresh the variables table', async () => {
    await renderApp('/variables');
    await waitFor(() => expect(variableRow('PORT')).toHaveTextContent('8080'));

    writeValue('.env', 'PORT', '9191');
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
    await waitFor(() => expect(variableRow('PORT')).toHaveTextContent('9191'));
  });

  it("refresh a file's raw text", async () => {
    const user = userEvent.setup();
    await renderApp('/files?focus=.env');
    const detail = await screen.findByRole('region', { name: '.env' });
    await user.click(within(detail).getByRole('tab', { name: 'Raw' }));
    const rawText = () =>
      within(envRegion()).getByRole('region', {
        name: 'The raw text of .env',
      });
    await waitFor(() => expect(rawText()).toBeInTheDocument());
    expect(rawText()).not.toHaveTextContent('ADDED_BY_HAND=1');

    mockState.lines.get('.env')!.push('ADDED_BY_HAND=1');
    await changeOutside(['.env']);

    await waitFor(() => expect(rawText()).toHaveTextContent('ADDED_BY_HAND=1'));
  });

  it('name every path that changed', async () => {
    await renderApp('/files');
    await screen.findByRole('article', { name: '.env' });
    await changeOutside(['.env', 'env.schema.json']);
    expect(
      await screen.findByText(
        '.env, env.schema.json changed outside the portal; the views show them now.',
      ),
    ).toBeInTheDocument();
  });

  it('refresh once and say so once for a burst of events', async () => {
    const info = vi.spyOn(toast, 'info');
    await renderApp('/files');
    await screen.findByRole('article', { name: '.env' });
    await waitFor(() => expect(eventClients.size).toBeGreaterThan(0));

    const reads = countReads('/api/files');
    // One save, then a checkout: several watcher events in a row.
    emitChanged(['.env']);
    emitChanged(['.env']);
    emitChanged(['env.schema.json']);

    expect(
      await screen.findByText(
        '.env, env.schema.json changed outside the portal; the views show them now.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads.count).toBeGreaterThan(0));
    expect(reads.count).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('refetch what changed while the stream was down, quietly', async () => {
    const info = vi.spyOn(toast, 'info');
    await renderApp('/variables');
    await waitFor(() => expect(variableRow('PORT')).toHaveTextContent('8080'));
    await waitFor(() => expect(eventClients.size).toBeGreaterThan(0));

    dropEvents();
    // Changed while the portal was not listening: no event names it.
    writeValue('.env', 'PORT', '9191');

    await waitFor(() => expect(variableRow('PORT')).toHaveTextContent('9191'));
    expect(info).not.toHaveBeenCalled();
  });

  it('say so when a change follows a cache event that is no write', async () => {
    // A controlled clock: only the test moves it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const user = userEvent.setup();
    const { queryClient } = await renderApp('/files?focus=.env');
    const detail = await screen.findByRole('region', { name: '.env' });
    await user.click(
      within(detail).getByRole('button', { name: 'Edit PORT in .env' }),
    );
    const input = within(detail).getByRole('textbox', {
      name: 'New value of PORT in .env',
    });
    await user.clear(input);
    await user.type(input, '9090');
    await user.click(within(detail).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved PORT in .env')).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    // The write is long past; the cache then drops it, as its GC does.
    vi.setSystemTime(Date.now() + OWN_WRITE_MS * 5);
    queryClient.getMutationCache().clear();
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
  });
});
