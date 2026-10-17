import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';
import { renderApp } from '../test/render';

const sidebarNav = () =>
  within(screen.getByTestId('app-sidebar')).getByRole('navigation', {
    name: 'Portal',
  });

describe('navigation', () => {
  it('moves between pages from the sidebar', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(within(sidebarNav()).getByRole('link', { name: 'Files' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Files' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/files');
    expect(
      within(sidebarNav()).getByRole('link', { name: 'Files' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(sidebarNav()).getByRole('link', { name: 'Overview' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('opens any page directly', async () => {
    await renderApp('/validate');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Validate' }),
    ).toBeInTheDocument();
  });

  it('opens the palette with Ctrl+K and jumps to a variable', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    await user.type(
      within(palette).getByPlaceholderText(/Type a variable/),
      'DB_PASS',
    );
    await user.click(await within(palette).findByText('DB_PASSWORD'));

    // The variable's drawer opens over the variables page.
    expect(
      await screen.findByRole('dialog', { name: 'DB_PASSWORD' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/variables');
    expect(router.state.location.search).toEqual({ focus: 'DB_PASSWORD' });
    expect(
      screen.queryByRole('dialog', { name: 'Command palette' }),
    ).not.toBeInTheDocument();
  });

  it('opens the palette from the header and jumps to a file', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole('button', { name: /Search/ }));
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    await user.click(await within(palette).findByText('config/app.env'));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Files' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ focus: 'config/app.env' });
  });

  it('jumps to a group from the palette', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    const groups = await within(palette).findByRole('group', {
      name: 'Groups',
    });
    await user.click(within(groups).getByText('Database'));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Groups' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ focus: 'Database' });
    expect(
      await screen.findByRole('article', { name: 'Database' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('switches the theme from the palette', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    await user.click(within(palette).getByText('Switch to the dark theme'));

    expect(document.documentElement).toHaveClass('dark');
  });
});
