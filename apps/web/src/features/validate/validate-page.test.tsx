import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { validationReport } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

const fileReport = (path: string) =>
  screen.findByRole('region', { name: path });
const messages = (region: HTMLElement) =>
  [...region.querySelectorAll('[data-message]')].map(
    (item) => item.textContent,
  );

describe('validate page', () => {
  it('groups the value and rule errors by file and variable', async () => {
    server.use(
      http.get('/api/validate', () => HttpResponse.json(validationReport)),
    );
    await renderApp('/validate');

    const env = await fileReport('.env');
    expect(within(env).getByText('4 errors')).toBeInTheDocument();
    const url = within(env).getByRole('region', { name: 'API_URL' });
    expect(messages(url)).toEqual(['is not a URL']);
    expect(within(url).getByRole('link', { name: 'API_URL' })).toHaveAttribute(
      'href',
      '/variables?focus=API_URL',
    );
    const password = within(env).getByRole('region', { name: 'DB_PASSWORD' });
    expect(messages(password)).toEqual([
      'must differ from API_KEY',
      'no longer matches the value the state recorded (The database was created with it.)',
    ]);
    expect(
      within(password).getByRole('link', { name: 'API_KEY' }),
    ).toHaveAttribute('href', '/variables?focus=API_KEY');
    const lines = within(env).getByRole('region', { name: 'Lines' });
    expect(messages(lines)).toEqual(['Line 6 is not a valid entry']);
    const warnings = within(env).getByRole('region', { name: 'Warnings' });
    expect(messages(warnings)).toEqual(['EXTRA is not in the schema']);
    expect(
      within(env).getByRole('button', { name: 'Fix API_URL in .env' }),
    ).toBeInTheDocument();
    expect(
      within(env).getByRole('button', { name: 'Fix DB_PASSWORD in .env' }),
    ).toBeInTheDocument();

    const app = await fileReport('config/app.env');
    expect(messages(within(app).getByRole('region', { name: 'PORT' }))).toEqual(
      ['must be a port between 1 and 65535'],
    );

    const example = await fileReport('.env.example');
    expect(within(example).getByText('Template')).toBeInTheDocument();
    expect(within(example).getByText('No errors.')).toBeInTheDocument();

    expect(screen.getByText('5 errors in 2 files.')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('fixes a value inline, and its errors go away', async () => {
    server.use(...scenarios.liveReports);
    const requests = recordRequests('/api/values');
    const user = userEvent.setup();
    await renderApp('/validate');
    const env = await fileReport('.env');
    expect(
      within(env).getByRole('region', { name: 'API_URL' }),
    ).toBeInTheDocument();

    await user.click(
      within(env).getByRole('button', { name: 'Fix API_URL in .env' }),
    );
    const input = within(env).getByRole('textbox', {
      name: 'New value of API_URL in .env',
    });
    await user.clear(input);
    await user.type(input, 'https://api.example.com');
    await user.click(within(env).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Saved API_URL in .env'),
    ).toBeInTheDocument();
    expect(requests).toEqual([
      [
        'POST',
        '/api/values/set',
        {
          file: '.env',
          fingerprint: 'env-1',
          values: { API_URL: 'https://api.example.com' },
        },
      ],
    ]);
    await waitFor(() =>
      expect(
        within(env).queryByRole('region', { name: 'API_URL' }),
      ).not.toBeInTheDocument(),
    );
    // The line that does not parse is still reported.
    expect(
      messages(within(env).getByRole('region', { name: 'Lines' })),
    ).toEqual(['Line 6 is not a valid entry']);
  });

  it('says when every value follows its rules', async () => {
    server.use(...scenarios.passing);
    await renderApp('/validate');
    expect(
      await screen.findByText('Every value follows its rules.'),
    ).toHaveAttribute('role', 'status');
  });

  it('runs validate again', async () => {
    let reads = 0;
    server.use(
      http.get('/api/validate', () => {
        reads += 1;
        return HttpResponse.json(validationReport);
      }),
    );
    const user = userEvent.setup();
    await renderApp('/validate');
    await fileReport('.env');
    const before = reads;
    await user.click(screen.getByRole('button', { name: 'Run validate' }));
    await waitFor(() => expect(reads).toBe(before + 1));
  });
});
