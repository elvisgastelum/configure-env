import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

/** The card of `name` on the groups page. */
const card = async (name: string) =>
  within((await screen.findByRole('article', { name })) as HTMLElement);

describe('groups page', () => {
  it('shows a card per group in schema order, the ungrouped ones last', async () => {
    await renderApp('/groups');

    await screen.findByRole('article', { name: 'Network' });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Network', 'Database', 'Ungrouped']);
  });

  it("shows each group's counts and the problems of its values", async () => {
    await renderApp('/groups');

    const network = await card('Network');
    expect(network.getByText('2 variables')).toBeInTheDocument();
    expect(network.getByText('1 required')).toBeInTheDocument();
    expect(network.queryByText(/secret/)).not.toBeInTheDocument();
    expect(network.getByText('1 invalid')).toBeInTheDocument();
    expect(network.getByText('1 missing')).toBeInTheDocument();

    const database = await card('Database');
    expect(database.getByText('1 variable')).toBeInTheDocument();
    expect(database.getByText('1 required')).toBeInTheDocument();
    expect(database.getByText('1 secret')).toBeInTheDocument();
    expect(database.getByText('1 protected')).toBeInTheDocument();

    const ungrouped = await card('Ungrouped');
    expect(ungrouped.getByText('2 variables')).toBeInTheDocument();
    expect(ungrouped.getByText('2 missing')).toBeInTheDocument();
    expect(ungrouped.getByText('1 drift')).toBeInTheDocument();
  });

  it('lists the members, each linking to its variable', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp('/groups');

    const network = await card('Network');
    const members = within(
      network.getByRole('list', { name: 'Variables in Network' }),
    )
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(members).toEqual(['API_URL', 'PORT']);

    await user.click(network.getByRole('link', { name: 'PORT' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/variables'),
    );
    expect(router.state.location.search).toEqual({ focus: 'PORT' });
  });

  it('opens the variables browser filtered to a group', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp('/groups');

    await user.click(
      (await card('Network')).getByRole('link', {
        name: 'View Network in Variables',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/variables'),
    );
    expect(router.state.location.search).toEqual({ group: 'Network' });
  });

  it('opens the variables browser on the ungrouped variables', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp('/groups');

    await user.click(
      (await card('Ungrouped')).getByRole('link', {
        name: 'View Ungrouped in Variables',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/variables'),
    );
    expect(router.state.location.search).toEqual({ group: null });
  });

  it('marks the group the palette jumped to', async () => {
    await renderApp('/groups?focus=Database');

    const database = await screen.findByRole('article', { name: 'Database' });
    expect(database).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByRole('article', { name: 'Network' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('points at init when the project has no schema', async () => {
    server.use(...scenarios.noSchema);
    await renderApp('/groups');
    expect(await screen.findByText('No schema yet')).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('reports an invalid schema', async () => {
    server.use(...scenarios.invalidSchema);
    await renderApp('/groups');
    expect(await screen.findByText('The schema has errors')).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
