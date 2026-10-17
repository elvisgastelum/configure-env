import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { secretValue, variables } from '../../mocks/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { REVEAL_TIMEOUT_MS } from './secrets';

const PASSWORD = secretValue('.env', 'DB_PASSWORD');

async function openVariables(path = '/variables') {
  const user = userEvent.setup({
    // Under fake timers, user-event's own pauses move the clock too.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
  const app = await renderApp(path);
  await screen.findByRole('grid', { name: 'Variables' });
  await screen.findByRole('row', { name: /^DB_PASSWORD/ });
  return { user, ...app };
}

const row = (name: string) =>
  screen.getByRole('row', { name: new RegExp(`^${name}`) });

afterEach(() => {
  vi.useRealTimers();
});

describe('secrets', () => {
  it('stay masked until revealed through the API', async () => {
    const requests: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.url.endsWith('/api/reveal'))
        requests.push(await request.clone().json());
    });
    const { user } = await openVariables();

    expect(within(row('DB_PASSWORD')).getByText('••••••••')).toBeVisible();
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();

    await user.click(
      within(row('DB_PASSWORD')).getByRole('button', {
        name: 'Reveal DB_PASSWORD in .env',
      }),
    );

    expect(await within(row('DB_PASSWORD')).findByText(PASSWORD)).toBeVisible();
    expect(requests).toEqual([{ file: '.env', key: 'DB_PASSWORD' }]);
  });

  it('hides a revealed value again on demand', async () => {
    const { user } = await openVariables();
    const cell = within(row('DB_PASSWORD'));

    await user.click(cell.getByRole('button', { name: /^Reveal/ }));
    await cell.findByText(PASSWORD);
    await user.click(
      cell.getByRole('button', { name: 'Hide DB_PASSWORD in .env' }),
    );

    expect(cell.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(cell.getByText('••••••••')).toBeVisible();
  });

  it('masks a revealed value again after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = await openVariables();
    const cell = within(row('DB_PASSWORD'));

    await user.click(cell.getByRole('button', { name: /^Reveal/ }));
    await cell.findByText(PASSWORD);

    act(() => vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1_000));
    expect(cell.getByText(PASSWORD)).toBeVisible();
    act(() => vi.advanceTimersByTime(1_000));
    expect(cell.queryByText(PASSWORD)).not.toBeInTheDocument();
  });

  it('reveals one value at a time', async () => {
    const twoSecrets = structuredClone(variables);
    const apiKey = twoSecrets.variables.find((v) => v.name === 'API_KEY')!;
    apiKey.files = [{ file: '.env', status: 'masked', value: '••••' }];
    server.use(
      http.get('/api/variables', () => HttpResponse.json(twoSecrets)),
      http.post('/api/reveal', async ({ request }) => {
        const { file, key } = (await request.json()) as Record<string, string>;
        return HttpResponse.json({
          file,
          key,
          value: secretValue(file!, key!),
        });
      }),
    );
    const { user } = await openVariables();

    await user.click(
      within(row('DB_PASSWORD')).getByRole('button', { name: /^Reveal/ }),
    );
    await screen.findByText(PASSWORD);
    await user.click(
      within(row('API_KEY')).getByRole('button', { name: /^Reveal/ }),
    );

    expect(
      await screen.findByText(secretValue('.env', 'API_KEY')),
    ).toBeVisible();
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  });

  it('never keeps a revealed value in the query cache', async () => {
    const { user, queryClient } = await openVariables();

    await user.click(
      within(row('DB_PASSWORD')).getByRole('button', { name: /^Reveal/ }),
    );
    await screen.findByText(PASSWORD);

    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.data),
    ]);
    expect(cached).not.toContain(PASSWORD);
  });

  it('says why a reveal failed', async () => {
    server.use(
      http.post('/api/reveal', () =>
        HttpResponse.json(
          { statusCode: 404, message: 'DB_PASSWORD is not in .env' },
          { status: 404 },
        ),
      ),
    );
    const { user } = await openVariables();

    await user.click(
      within(row('DB_PASSWORD')).getByRole('button', { name: /^Reveal/ }),
    );

    expect(
      await screen.findByText('Could not reveal: DB_PASSWORD is not in .env'),
    ).toBeInTheDocument();
  });

  it('reveals in the drawer too, and explains a protected variable', async () => {
    const user = userEvent.setup();
    await renderApp('/variables?focus=DB_PASSWORD');
    const dialog = await screen.findByRole('dialog', { name: 'DB_PASSWORD' });

    const note = within(dialog).getByRole('note');
    expect(note).toHaveTextContent('Protected');
    expect(note).toHaveTextContent('The database was created with it.');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Reveal DB_PASSWORD in .env',
      }),
    );
    await waitFor(() =>
      expect(within(dialog).getByText(PASSWORD)).toBeVisible(),
    );
  });
});
