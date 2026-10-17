import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { checkReport } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

const group = (path: string) => screen.findByRole('region', { name: path });
const problems = (region: HTMLElement) =>
  within(region).queryAllByRole('listitem');
const messages = (region: HTMLElement) =>
  problems(region).map(
    (item) => item.querySelector('[data-message]')?.textContent,
  );

describe('check page', () => {
  it('sums the report up at the top, linking to each failing file', async () => {
    server.use(...scenarios.everyProblem);
    const user = userEvent.setup();
    await renderApp('/check');

    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(summary).toHaveTextContent('7 errors');
    expect(summary).toHaveTextContent('1 warning');
    expect(summary).toHaveTextContent('2 of 3 files failing');
    const jump = within(summary).getByRole('navigation', {
      name: 'Files with errors',
    });
    expect(
      within(jump)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['.env 6 errors', 'config/app.env 1 error']);
    expect(summary).toHaveTextContent('LOG_LEVEL must be one of debug, info');

    await user.click(within(jump).getByRole('link', { name: /config\/app/ }));
    expect(await group('config/app.env')).toHaveFocus();
  });

  it('lists each file in schema order, its problems errors first', async () => {
    server.use(...scenarios.everyProblem);
    await renderApp('/check');

    const env = await group('.env');
    expect(within(env).getByText('Missing keys')).toBeInTheDocument();
    expect(messages(env)).toEqual([
      'Mode 644, the schema wants 600',
      'API_KEY is missing',
      'Line 6 is not a valid entry',
      'API_URL is not a URL: localhost:4000',
      'DB_PASSWORD must differ from API_KEY',
      'DB_PASSWORD no longer matches the value recorded on 2026-09-30 (The database was created with it.)',
      'EXTRA is not in the schema for this file',
    ]);
    const [first, ...rest] = problems(env);
    expect(within(first!).getByText('Error')).toBeInTheDocument();
    expect(within(first!).getByText('mode')).toBeInTheDocument();
    const last = rest.at(-1)!;
    expect(within(last).getByText('Warning')).toBeInTheDocument();
    expect(within(last).getByText('unknown-key')).toBeInTheDocument();
    expect(within(env).getByRole('link', { name: 'API_URL' })).toHaveAttribute(
      'href',
      '/variables?focus=API_URL',
    );
    expect(
      within(env).getAllByRole('link', { name: 'API_KEY' })[0],
    ).toHaveAttribute('href', '/variables?focus=API_KEY');
    for (const name of [
      'Set API_KEY in .env',
      'Set API_URL in .env',
      'Apply .env',
      'Apply .env and prune',
    ])
      expect(within(env).getByRole('button', { name })).toBeInTheDocument();
    expect(
      within(env).getByRole('link', { name: 'Open .env' }),
    ).toHaveAttribute('href', '/files?focus=.env');

    const app = await group('config/app.env');
    expect(messages(app)).toEqual(['The file does not exist yet']);
    expect(
      within(app).getByRole('button', { name: 'Apply config/app.env' }),
    ).toBeInTheDocument();

    const example = await group('.env.example');
    expect(within(example).getByText('Passes')).toBeInTheDocument();
    expect(problems(example)).toEqual([]);

    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
        .filter((text) => text?.includes('env')),
    ).toEqual(['.env', '.env.example', 'config/app.env']);
  });

  it('filters by severity with the counts on the chips, kept in the address', async () => {
    server.use(...scenarios.everyProblem);
    const user = userEvent.setup();
    const { router } = await renderApp('/check');
    await group('.env');

    const filter = screen.getByRole('group', { name: 'Show problems' });
    const all = within(filter).getByRole('button', { name: 'All 8' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    const warnings = within(filter).getByRole('button', { name: 'Warnings 1' });
    expect(warnings).toHaveAttribute('aria-pressed', 'false');
    expect(
      within(filter).getByRole('button', { name: 'Errors 7' }),
    ).toBeInTheDocument();

    await user.click(warnings);
    expect(warnings).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toEqual({ severity: 'warning' });
    expect(messages(await group('.env'))).toEqual([
      'EXTRA is not in the schema for this file',
    ]);
    expect(
      screen.queryByRole('region', { name: 'config/app.env' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: '.env.example' }),
    ).not.toBeInTheDocument();
  });

  it('opens with the severity in its address', async () => {
    server.use(...scenarios.everyProblem);
    await renderApp('/check?severity=error');
    const env = await group('.env');
    expect(messages(env)).not.toContain(
      'EXTRA is not in the schema for this file',
    );
    expect(screen.getByRole('button', { name: 'Errors 7' })).toHaveAttribute(
      'aria-pressed',
      'true',
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
    await waitFor(() =>
      expect(messages(env)).not.toContain('API_KEY is missing'),
    );
    expect(document.body).not.toHaveTextContent(value);
  });

  it('fixes an invalid value in place, and the lines still report', async () => {
    server.use(...scenarios.liveReports);
    const user = userEvent.setup();
    await renderApp('/check');
    const env = await group('.env');
    expect(messages(env)).toContain('API_URL is not a URL: localhost:4000');

    await user.click(
      within(env).getByRole('button', { name: 'Set API_URL in .env' }),
    );
    const input = within(env).getByRole('textbox', {
      name: 'New value of API_URL in .env',
    });
    await user.clear(input);
    await user.type(input, 'https://api.example.com');
    await user.click(within(env).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(messages(env)).not.toContain(
        'API_URL is not a URL: localhost:4000',
      ),
    );
    expect(messages(env)).toContain('Line 6 is not a valid entry');
  });

  it('applies one file from its report, and the file passes after', async () => {
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
      expect(within(app).getByText('Passes')).toBeInTheDocument(),
    );
  });

  it('prunes the keys the schema does not declare', async () => {
    server.use(...scenarios.liveReports);
    const requests = recordRequests('/api/plan');
    const user = userEvent.setup();
    await renderApp('/check');
    const env = await group('.env');
    expect(messages(env)).toContain('EXTRA is not in the schema for this file');

    await user.click(
      within(env).getByRole('button', { name: 'Apply .env and prune' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Apply' });
    await waitFor(() =>
      expect(requests[0]).toEqual([
        'POST',
        '/api/plan',
        { files: ['.env'], prune: true },
      ]),
    );
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByRole('region', { name: '.env' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    await user.click(within(dialog).getByRole('button', { name: 'Write' }));
    await within(dialog).findByRole('list', { name: 'Result per file' });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() =>
      expect(messages(env)).not.toContain(
        'EXTRA is not in the schema for this file',
      ),
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

  it('says when every env file passes', async () => {
    server.use(...scenarios.passing);
    await renderApp('/check');
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(summary).toHaveTextContent('Every env file passes.');
    expect(
      screen.queryByRole('group', { name: 'Show problems' }),
    ).not.toBeInTheDocument();
  });

  it('counts warnings that do not fail the check', async () => {
    server.use(...scenarios.onlyWarnings);
    await renderApp('/check');
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(summary).toHaveTextContent('0 errors');
    expect(summary).toHaveTextContent('2 warnings');
    expect(summary).toHaveTextContent('0 of 2 files failing');
    expect(
      within(summary).queryByRole('navigation', { name: 'Files with errors' }),
    ).not.toBeInTheDocument();
    expect(messages(await group('.env'))).toEqual([
      'EXTRA is not in the schema for this file',
      'LEGACY_TOKEN is not in the schema for this file',
    ]);
  });

  it('runs check again and announces the result without moving focus', async () => {
    let reads = 0;
    server.use(
      http.get('/api/check', () => {
        reads += 1;
        return HttpResponse.json(checkReport);
      }),
    );
    const user = userEvent.setup();
    await renderApp('/check');
    await group('.env');
    const before = reads;
    const run = screen.getByRole('button', { name: 'Run check' });
    await user.click(run);

    await waitFor(() => expect(reads).toBe(before + 1));
    expect(
      await screen.findByText('Check finished: 7 errors, 1 warning.'),
    ).toHaveAttribute('role', 'status');
    expect(run).toHaveFocus();
  });
});
