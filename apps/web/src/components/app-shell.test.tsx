import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { scenarios } from '../mocks/handlers';
import { renderApp } from '../test/render';
import { server } from '../test/server';

describe('the shell', () => {
  it('shows the project, its root and the schema status', async () => {
    await renderApp();

    const header = screen.getByTestId('app-header');
    expect(
      await within(header).findByText('billing-service'),
    ).toBeInTheDocument();
    expect(
      within(header).getByText('/home/ada/code/billing-service'),
    ).toBeInTheDocument();
    expect(
      await within(header).findByRole('link', { name: 'Schema valid' }),
    ).toHaveAttribute('href', '/schema');
  });

  it('lists every page in the sidebar', async () => {
    await renderApp();

    const nav = within(screen.getByTestId('app-sidebar')).getByRole(
      'navigation',
      { name: 'Portal' },
    );
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Variables',
      'Groups',
      'Files',
      'Schema',
      'Check',
      'Validate',
      'History',
    ]);
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('reports a missing or invalid schema in the pill', async () => {
    server.use(...scenarios.invalidSchema);
    await renderApp();

    expect(
      await screen.findByRole('link', { name: 'Schema: 2 errors' }),
    ).toBeInTheDocument();
  });

  it('says so when the schema does not exist yet', async () => {
    server.use(...scenarios.noSchema);
    await renderApp();

    expect(
      await screen.findByRole('link', { name: 'No schema' }),
    ).toBeInTheDocument();
  });

  it('lifts the header once the page scrolls', async () => {
    await renderApp();
    const header = screen.getByTestId('app-header');
    expect(header).toHaveAttribute('data-scrolled', 'false');

    await act(async () => {
      Object.defineProperty(window, 'scrollY', {
        value: 120,
        configurable: true,
      });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(header).toHaveAttribute('data-scrolled', 'true');

    await act(async () => {
      Object.defineProperty(window, 'scrollY', {
        value: 0,
        configurable: true,
      });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(header).toHaveAttribute('data-scrolled', 'false');
  });

  it('collapses the sidebar to icons', async () => {
    const user = userEvent.setup();
    await renderApp();
    const sidebar = screen.getByTestId('app-sidebar');

    await user.click(
      within(sidebar).getByRole('button', { name: 'Collapse sidebar' }),
    );
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    // The labels stay for assistive tech.
    expect(within(sidebar).getByRole('link', { name: 'Files' })).toBeVisible();

    await user.click(
      within(sidebar).getByRole('button', { name: 'Expand sidebar' }),
    );
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  });

  it('opens the navigation in a sheet on small screens', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const sheet = await screen.findByRole('dialog', { name: 'configure-env' });
    expect(
      within(sheet).getByRole('group', { name: 'Theme' }),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole('link', { name: 'Check' }));
    expect(router.state.location.pathname).toBe('/check');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('asks for the launch link when the session is refused', async () => {
    server.use(...scenarios.unauthorized);
    await renderApp();

    expect(
      await screen.findByRole('heading', {
        name: 'Open the launch link again',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
  });
});
