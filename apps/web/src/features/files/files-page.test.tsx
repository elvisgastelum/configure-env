import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { OWN_WRITE_MS } from '../../lib/use-project-events';
import { findFile } from '../../mocks/store';
import { changeOutside } from '../../test/events';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

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

/** The card of `path` on the files page. */
const card = async (path: string) =>
  (await screen.findByRole('article', { name: path })) as HTMLElement;

async function openFile(path: string) {
  const user = userEvent.setup();
  const app = await renderApp('/files');
  await user.click(
    within(await card(path)).getByRole('button', { name: `Open ${path}` }),
  );
  const detail = await screen.findByRole('region', { name: path });
  return { user, detail, ...app };
}

describe('files page', () => {
  it('shows a card per file with its policy, mode, template flag, existence, drift and parse errors', async () => {
    await renderApp('/files');

    const env = within(await card('.env'));
    expect(env.getByText('merge')).toBeInTheDocument();
    expect(env.getByText('644, expects 600')).toBeInTheDocument();
    expect(env.getByText('Exists')).toBeInTheDocument();
    expect(env.getByText('Missing keys')).toBeInTheDocument();
    expect(env.getByText('1 bad line')).toBeInTheDocument();
    expect(env.queryByText('Template')).not.toBeInTheDocument();

    const example = within(await card('.env.example'));
    expect(example.getByText('generate')).toBeInTheDocument();
    expect(example.getByText('Template')).toBeInTheDocument();
    expect(example.getByText('Current')).toBeInTheDocument();
    expect(example.queryByText(/bad line/)).not.toBeInTheDocument();

    const app = within(await card('config/app.env'));
    expect(app.getByText('Missing')).toBeInTheDocument();
    expect(app.getByText('Not created')).toBeInTheDocument();
  });

  it('keeps the overview cards as they were: no open action, no existence', async () => {
    await renderApp('/');
    const env = within(
      (await screen.findByRole('article', { name: '.env' })) as HTMLElement,
    );
    expect(env.getByText('Missing keys')).toBeInTheDocument();
    expect(env.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(
      env.queryByRole('button', { name: 'Open .env' }),
    ).not.toBeInTheDocument();
    expect(env.queryByText('Exists')).not.toBeInTheDocument();
  });

  it("opens a file's detail with its entries in order, secrets masked", async () => {
    const { detail, router } = await openFile('.env');

    expect(router.state.location.search).toEqual({ focus: '.env' });
    const table = within(detail).getByRole('table', {
      name: 'The variables .env lists, in order',
    });
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(names).toEqual([
      'API_URL',
      'PORT',
      'DB_PASSWORD',
      'API_KEY',
      'LOG_LEVEL',
    ]);
    const password = within(table).getByRole('row', { name: /DB_PASSWORD/ });
    expect(within(password).getByText('••••••••')).toBeInTheDocument();
    expect(
      within(table).getByRole('row', { name: /API_URL/ }),
    ).toHaveTextContent('is not a URL');
    expect(within(detail).getByText('EXTRA')).toBeInTheDocument();
  });

  it('goes back to every card', async () => {
    const { user, detail, router } = await openFile('.env');
    await user.click(within(detail).getByRole('button', { name: 'All files' }));
    expect(await card('config/app.env')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it('opens the detail from the palette jump', async () => {
    await renderApp('/files?focus=config/app.env');
    const detail = await screen.findByRole('region', {
      name: 'config/app.env',
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Files' }),
    ).toBeInTheDocument();
    const table = within(detail).getByRole('table');
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['PORT', 'LOG_LEVEL']);
  });

  it('edits an entry in place with the variables editor', async () => {
    const requests = recordRequests('/api/values');
    const { user, detail } = await openFile('.env');

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
    expect(requests).toEqual([
      [
        'POST',
        '/api/values/set',
        { file: '.env', fingerprint: 'env-1', values: { PORT: '9090' } },
      ],
    ]);
    const row = within(detail).getByRole('row', { name: /PORT/ });
    await waitFor(() => expect(row).toHaveTextContent('9090'));
  });

  it('shows the raw text read-only and highlighted, secrets masked', async () => {
    const requests = recordRequests('/api/files/content');
    const { user, detail } = await openFile('.env');

    await user.click(within(detail).getByRole('tab', { name: 'Raw' }));
    const raw = await within(detail).findByRole('region', {
      name: 'The raw text of .env',
    });
    expect(requests).toEqual([
      ['POST', '/api/files/content', { file: '.env' }],
    ]);
    const lines = raw.querySelectorAll('[data-line]');
    expect([...lines].map((line) => line.textContent)).toEqual([
      '# The billing service',
      'API_URL=localhost:4000',
      'PORT=8080',
      'DB_PASSWORD=••••••••',
      'LOG_LEVEL=debug  # every request',
      'this line is not an entry',
      'export EXTRA="1"',
    ]);
    const token = (line: number, kind: string) =>
      [...lines[line - 1]!.querySelectorAll(`[data-token="${kind}"]`)].map(
        (span) => span.textContent,
      );
    expect(token(1, 'comment')).toEqual(['# The billing service']);
    expect(token(2, 'key')).toEqual(['API_URL']);
    expect(token(2, 'value')).toEqual(['localhost:4000']);
    expect(token(5, 'comment')).toEqual(['# every request']);
    expect(token(7, 'keyword')).toEqual(['export']);
    expect(token(7, 'value')).toEqual(['"1"']);
    expect(lines[5]).toHaveAttribute('data-invalid', 'true');
    expect(
      within(raw).getByTitle('Line 6 is not a valid entry'),
    ).toBeInTheDocument();
    expect(within(raw).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says a file that does not exist has no raw text yet', async () => {
    const { user, detail } = await openFile('config/app.env');
    await user.click(within(detail).getByRole('tab', { name: 'Raw' }));
    expect(
      await within(detail).findByText(
        'config/app.env does not exist yet; apply creates it.',
      ),
    ).toBeInTheDocument();
  });
});

describe('live state', () => {
  it('refreshes the files and says so when one changes outside the portal', async () => {
    await renderApp('/files');
    const env = await card('.env');
    expect(within(env).getByText('Missing keys')).toBeInTheDocument();

    const info = findFile('.env')!;
    info.drift = {
      status: 'current',
      drift: false,
      missingKeys: [],
      unknownKeys: [],
    };
    await changeOutside(['.env']);

    expect(
      await screen.findByText(
        '.env changed outside the portal; the views show it now.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(env).getByText('Current')).toBeInTheDocument(),
    );
  });

  it("refreshes quietly after the portal's own write", async () => {
    // A controlled clock: the change lands inside the own-write window
    // however slow the run is.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const info = vi.spyOn(toast, 'info');
    const { user, detail, queryClient } = await openFile('.env');
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

    vi.setSystemTime(Date.now() + OWN_WRITE_MS - 1);
    const reads = countReads('/api/files');
    await changeOutside(['.env']);
    // The refetch starts once the hook has handled the event, toast or not.
    await waitFor(() => expect(reads.count).toBeGreaterThan(0));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(info).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/changed outside the portal/),
    ).not.toBeInTheDocument();
  });
});
