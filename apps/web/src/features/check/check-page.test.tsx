import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { driftCheck } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

const group = (path: string) => screen.findByRole('region', { name: path });
const items = (region: HTMLElement) =>
  within(within(region).getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-message]')?.textContent);

describe('check page', () => {
  it('groups the drift by file, each item linking to its variable', async () => {
    server.use(http.get('/api/check', () => HttpResponse.json(driftCheck)));
    await renderApp('/check');

    const env = await group('.env');
    expect(within(env).getByText('Missing keys')).toBeInTheDocument();
    expect(items(env)).toEqual([
      'API_KEY is missing',
      'API_URL is not a URL: localhost:4000',
      'DB_PASSWORD must differ from API_KEY',
      'DB_PASSWORD no longer matches the value the state recorded (The database was created with it.)',
      'EXTRA is not in the schema',
      'Mode 644, the schema wants 600',
      'Line 6 is not a valid entry',
    ]);
    expect(
      within(env).getAllByRole('link', { name: 'API_KEY' })[0],
    ).toHaveAttribute('href', '/variables?focus=API_KEY');
    expect(within(env).getByRole('link', { name: 'API_URL' })).toHaveAttribute(
      'href',
      '/variables?focus=API_URL',
    );
    expect(
      within(env).getByRole('button', { name: 'Set API_KEY in .env' }),
    ).toBeInTheDocument();
    expect(
      within(env).getByRole('button', { name: 'Set API_URL in .env' }),
    ).toBeInTheDocument();
    expect(
      within(env).getByRole('button', { name: 'Apply .env' }),
    ).toBeInTheDocument();
    expect(
      within(env).getByRole('link', { name: 'Open .env' }),
    ).toHaveAttribute('href', '/files?focus=.env');

    const app = await group('config/app.env');
    expect(items(app)).toEqual(['The file does not exist yet']);
    expect(
      within(app).getByRole('button', { name: 'Apply config/app.env' }),
    ).toBeInTheDocument();

    const example = await group('.env.example');
    expect(within(example).getByText('Nothing to fix.')).toBeInTheDocument();

    const errors = screen.getByRole('region', { name: 'Value errors' });
    expect(errors).toHaveTextContent('LOG_LEVEL must be one of debug, info');
    expect(screen.getByText('2 files drift from the schema.')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('sets a missing value in place, and the item goes away', async () => {
    server.use(...scenarios.liveReports);
    const requests = recordRequests('/api/values');
    const user = userEvent.setup();
    await renderApp('/check');
    const env = await group('.env');

    await user.click(
      within(env).getByRole('button', { name: 'Set API_KEY in .env' }),
    );
    const value = ['partner', 'key', String(Date.now())].join('-');
    await user.type(
      within(env).getByLabelText('New value of API_KEY in .env'),
      value,
    );
    await user.click(within(env).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Saved API_KEY in .env'),
    ).toBeInTheDocument();
    expect(requests).toEqual([
      [
        'POST',
        '/api/values/set',
        { file: '.env', fingerprint: 'env-1', values: { API_KEY: value } },
      ],
    ]);
    await waitFor(() => expect(items(env)).not.toContain('API_KEY is missing'));
    expect(document.body).not.toHaveTextContent(value);
  });

  it('applies one file from its drift, and the file is current after', async () => {
    server.use(...scenarios.liveReports);
    const requests = recordRequests('/api/plan');
    const user = userEvent.setup();
    await renderApp('/check');
    const app = await group('config/app.env');

    await user.click(
      within(app).getByRole('button', { name: 'Apply config/app.env' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Apply' });
    expect(dialog).toHaveTextContent('Write config/app.env as the schema');
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByRole('region', { name: 'config/app.env' });
    expect(requests[0]).toEqual([
      'POST',
      '/api/plan',
      { files: ['config/app.env'] },
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    await user.click(within(dialog).getByRole('button', { name: 'Write' }));
    await within(dialog).findByRole('list', { name: 'Result per file' });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() =>
      expect(within(app).getByText('Nothing to fix.')).toBeInTheDocument(),
    );
  });

  it('opens only the editor of the item whose Set was pressed', async () => {
    server.use(...scenarios.everyProblem);
    const user = userEvent.setup();
    await renderApp('/check');
    const env = await group('.env');
    // DB_PASSWORD has a rule item and a protected item.
    const sets = within(env).getAllByRole('button', {
      name: 'Set DB_PASSWORD in .env',
    });
    expect(sets).toHaveLength(2);

    await user.click(sets[0]!);
    expect(
      within(env).getAllByLabelText('New value of DB_PASSWORD in .env'),
    ).toHaveLength(1);
    expect(
      within(env).getAllByRole('button', { name: 'Set DB_PASSWORD in .env' }),
    ).toHaveLength(1);
  });

  it('says values cannot be set when the variables cannot be read', async () => {
    server.use(
      ...scenarios.everyProblem,
      http.get('/api/variables', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'the variables could not be read' },
          { status: 500 },
        ),
      ),
    );
    await renderApp('/check');
    const env = await group('.env');

    expect(
      await screen.findByText(
        'Values cannot be set right now: the variables could not be read',
      ),
    ).toHaveAttribute('role', 'alert');
    expect(
      within(env).queryByRole('button', { name: /^Set / }),
    ).not.toBeInTheDocument();
    expect(
      within(env).getByRole('button', { name: 'Apply .env' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Apply every file' }),
    ).toBeEnabled();
  });

  it('says when every file matches the schema', async () => {
    server.use(...scenarios.passing);
    await renderApp('/check');
    expect(
      await screen.findByText('Every env file matches the schema.'),
    ).toHaveAttribute('role', 'status');
  });

  it('runs check again', async () => {
    let reads = 0;
    server.use(
      http.get('/api/check', () => {
        reads += 1;
        return HttpResponse.json(driftCheck);
      }),
    );
    const user = userEvent.setup();
    await renderApp('/check');
    await group('.env');
    const before = reads;
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() => expect(reads).toBe(before + 1));
  });
});
