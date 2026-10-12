import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { passingCheck } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const stat = (name: string) =>
  screen.getByRole('group', { name }).querySelector('[data-slot=stat-value]');

describe('the overview', () => {
  it('counts variables, secrets, required ones and groups', async () => {
    await renderApp();

    await screen.findByRole('group', { name: 'Variables' });
    await waitFor(() => expect(stat('Variables')).toHaveTextContent('5'));
    expect(stat('Secrets')).toHaveTextContent('2');
    expect(stat('Required')).toHaveTextContent('2');
    expect(stat('Groups')).toHaveTextContent('2');
  });

  it('shows a card per env file with its policy, mode and drift', async () => {
    await renderApp();

    const env = await screen.findByRole('article', { name: '.env' });
    expect(within(env).getByText('merge')).toBeInTheDocument();
    expect(within(env).getByText('644, expects 600')).toBeInTheDocument();
    expect(within(env).getByText('Missing keys')).toBeInTheDocument();

    const example = screen.getByRole('article', { name: '.env.example' });
    expect(within(example).getByText('generate')).toBeInTheDocument();
    expect(within(example).getByText('Template')).toBeInTheDocument();
    expect(within(example).getByText('Current')).toBeInTheDocument();

    const config = screen.getByRole('article', { name: 'config/app.env' });
    expect(within(config).getByText('Not created')).toBeInTheDocument();
  });

  it('expands a file card to its missing and unknown keys', async () => {
    const user = userEvent.setup();
    await renderApp();

    const env = await screen.findByRole('article', { name: '.env' });
    const toggle = within(env).getByRole('button', { name: 'Details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(env).getByText('API_KEY')).toBeInTheDocument();
    expect(within(env).getByText('EXTRA')).toBeInTheDocument();
    expect(within(env).getByText(/Line 6: not a KEY=value line/)).toBeVisible();

    await user.click(toggle);
    await waitFor(() =>
      expect(within(env).queryByText('EXTRA')).not.toBeInTheDocument(),
    );
  });

  it('shows the check and validate status', async () => {
    await renderApp();

    const check = await screen.findByRole('region', { name: 'Check' });
    expect(await within(check).findByText('1 issue')).toBeInTheDocument();
    const validate = screen.getByRole('region', { name: 'Validate' });
    expect(await within(validate).findByText('1 error')).toBeInTheDocument();
  });

  it('runs check again in one click', async () => {
    const user = userEvent.setup();
    await renderApp();
    const check = await screen.findByRole('region', { name: 'Check' });
    await within(check).findByText('1 issue');

    server.use(http.get('/api/check', () => HttpResponse.json(passingCheck)));
    await user.click(within(check).getByRole('button', { name: 'Run check' }));

    expect(await within(check).findByText('Passing')).toBeInTheDocument();
  });

  it('links each status to its report', async () => {
    await renderApp();
    const validate = await screen.findByRole('region', { name: 'Validate' });
    expect(
      within(validate).getByRole('link', { name: 'Open the report' }),
    ).toHaveAttribute('href', '/validate');
  });

  it('shows skeletons while the project loads', async () => {
    server.use(...scenarios.loading);
    await renderApp();

    expect(screen.getAllByTestId('overview-skeleton').length).toBeGreaterThan(
      0,
    );
  });

  it('offers init when the project has no schema yet', async () => {
    server.use(...scenarios.noSchema);
    await renderApp();

    expect(
      await screen.findByRole('heading', { name: 'No schema yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('npx configure-env init')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /How init works/ }),
    ).toHaveAttribute(
      'href',
      'https://github.com/elvisgastelum/configure-env#init',
    );
    expect(screen.queryByRole('group', { name: 'Variables' })).toBeNull();
  });

  it('lists the errors of an invalid schema', async () => {
    server.use(...scenarios.invalidSchema);
    await renderApp();

    expect(
      await screen.findByRole('heading', { name: 'The schema has errors' }),
    ).toBeInTheDocument();
    expect(screen.getByText('must be 1')).toBeInTheDocument();
    expect(screen.getByText('version')).toBeInTheDocument();
  });
});
