import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { scenarios } from '../mocks/handlers';
import { mockState, writeValue } from '../mocks/store';
import { changeOutside } from '../test/events';
import { renderApp } from '../test/render';
import { server } from '../test/server';

const toastFor = (paths: string) =>
  screen.findByText(
    `${paths} changed outside the portal; the views show it now.`,
  );

describe('external changes', () => {
  it('refresh the check report', async () => {
    server.use(...scenarios.liveReports);
    await renderApp('/check');
    const env = await screen.findByRole('region', { name: '.env' });
    expect(env).toHaveTextContent('API_KEY is missing');

    writeValue('.env', 'API_KEY', ['outside', String(Date.now())].join('-'));
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
    await waitFor(() =>
      expect(env).not.toHaveTextContent('API_KEY is missing'),
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
        within(env).queryByRole('region', { name: 'API_URL' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('refresh the variables table', async () => {
    await renderApp('/variables');
    const row = await waitFor(() => {
      const found = document.querySelector('[data-variable="PORT"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(row).toHaveTextContent('8080');

    writeValue('.env', 'PORT', '9191');
    await changeOutside(['.env']);

    expect(await toastFor('.env')).toBeInTheDocument();
    await waitFor(() => expect(row).toHaveTextContent('9191'));
  });

  it("refresh a file's raw text", async () => {
    const user = userEvent.setup();
    await renderApp('/files?focus=.env');
    const detail = await screen.findByRole('region', { name: '.env' });
    await user.click(within(detail).getByRole('tab', { name: 'Raw' }));
    const raw = await within(detail).findByRole('region', {
      name: 'The raw text of .env',
    });
    expect(raw).not.toHaveTextContent('ADDED_BY_HAND=1');

    mockState.lines.get('.env')!.push('ADDED_BY_HAND=1');
    await changeOutside(['.env']);

    await waitFor(() => expect(raw).toHaveTextContent('ADDED_BY_HAND=1'));
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
});
