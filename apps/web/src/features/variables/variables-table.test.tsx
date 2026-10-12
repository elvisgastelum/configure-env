import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { manyVariables } from '../../mocks/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

/** The variable rows the grid renders, in order. */
const rowNames = () =>
  [
    ...screen
      .getByRole('grid', { name: 'Variables' })
      .querySelectorAll('[data-variable]'),
  ].map((row) => row.getAttribute('data-variable'));

async function openVariables(path = '/variables') {
  const user = userEvent.setup();
  const app = await renderApp(path);
  await screen.findByRole('grid', { name: 'Variables' });
  await waitFor(() => expect(rowNames().length).toBeGreaterThan(0));
  return { user, ...app };
}

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  select: string,
  option: string,
) => {
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('the variables table', () => {
  it('lists every variable under its group heading', async () => {
    await openVariables();

    expect(rowNames()).toEqual([
      'API_URL',
      'PORT',
      'DB_PASSWORD',
      'API_KEY',
      'LOG_LEVEL',
    ]);
    const headers = screen
      .getAllByRole('rowheader')
      .filter((cell) => cell.closest('[data-group]'));
    expect(headers.map((cell) => cell.textContent)).toEqual([
      'Network2',
      'Database1',
      'Ungrouped2',
    ]);
    expect(screen.getByText('5 variables')).toBeInTheDocument();
  });

  it('shows each value in the first file, and what is wrong with it', async () => {
    await openVariables();

    const row = (name: string) =>
      screen.getByRole('row', { name: new RegExp(`^${name}`) });
    expect(
      screen.getByRole('columnheader', { name: 'Value in .env' }),
    ).toBeInTheDocument();
    expect(within(row('PORT')).getByText('8080')).toBeInTheDocument();
    expect(within(row('API_URL')).getByText('Invalid')).toBeInTheDocument();
    expect(within(row('API_KEY')).getByText('Missing')).toBeInTheDocument();
    expect(within(row('API_KEY')).getByText('Drift')).toBeInTheDocument();
    expect(
      within(row('DB_PASSWORD')).getByText('••••••••'),
    ).toBeInTheDocument();
    expect(
      within(row('DB_PASSWORD')).getByRole('img', { name: 'Protected' }),
    ).toBeInTheDocument();
  });

  it('searches names, descriptions and comments', async () => {
    const { user } = await openVariables();
    const search = screen.getByRole('searchbox', { name: 'Search variables' });

    await user.type(search, 'listens');
    expect(rowNames()).toEqual(['PORT']);

    await user.clear(search);
    await user.type(search, 'every request');
    expect(rowNames()).toEqual(['LOG_LEVEL']);

    await user.clear(search);
    await user.type(search, 'nothing like this');
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No variable matches.')).toBeInTheDocument();
  });

  it('filters by type, group, flags, file and status', async () => {
    const { user } = await openVariables();

    await choose(user, 'Type', 'enum');
    expect(rowNames()).toEqual(['LOG_LEVEL']);
    await choose(user, 'Type', 'Any type');

    await choose(user, 'Group', 'Network');
    expect(rowNames()).toEqual(['API_URL', 'PORT']);
    await choose(user, 'Group', 'Ungrouped');
    expect(rowNames()).toEqual(['API_KEY', 'LOG_LEVEL']);
    await choose(user, 'Group', 'Any group');

    await user.click(screen.getByRole('button', { name: 'Secret' }));
    expect(rowNames()).toEqual(['DB_PASSWORD', 'API_KEY']);
    await user.click(screen.getByRole('button', { name: 'Protected' }));
    expect(rowNames()).toEqual(['DB_PASSWORD']);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await user.click(screen.getByRole('button', { name: 'Required' }));
    expect(rowNames()).toEqual(['API_URL', 'DB_PASSWORD']);
    await user.click(screen.getByRole('button', { name: 'Required' }));

    await choose(user, 'File', 'config/app.env');
    expect(rowNames()).toEqual(['PORT', 'LOG_LEVEL']);
    expect(
      screen.getByRole('columnheader', { name: 'Value in config/app.env' }),
    ).toBeInTheDocument();
    await choose(user, 'File', 'Any file');

    await choose(user, 'Status', 'Invalid');
    expect(rowNames()).toEqual(['API_URL']);
    await choose(user, 'Status', 'Drift');
    expect(rowNames()).toEqual(['API_KEY']);
    await choose(user, 'Status', 'Missing');
    expect(rowNames()).toEqual(['PORT', 'DB_PASSWORD', 'API_KEY', 'LOG_LEVEL']);
    expect(screen.getByText('4 of 5 variables')).toBeInTheDocument();
  });

  it('sorts inside each group', async () => {
    const { user } = await openVariables();

    await choose(user, 'Sort', 'Name, Z to A');
    expect(rowNames()).toEqual([
      'PORT',
      'API_URL',
      'DB_PASSWORD',
      'LOG_LEVEL',
      'API_KEY',
    ]);
    await choose(user, 'Sort', 'Type');
    expect(rowNames()).toEqual([
      'PORT',
      'API_URL',
      'DB_PASSWORD',
      'LOG_LEVEL',
      'API_KEY',
    ]);
    await choose(user, 'Sort', 'Schema order');
    expect(rowNames()[0]).toBe('API_URL');
  });

  it('selects the variable the palette jumped to', async () => {
    await renderApp('/variables?focus=LOG_LEVEL');
    // Its drawer opens over the table, which the dialog hides from the
    // accessibility tree meanwhile.
    await screen.findByRole('dialog', { name: 'LOG_LEVEL' });

    const row = document.querySelector('[data-variable="LOG_LEVEL"]')!;
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[role=grid]')).toHaveAttribute(
      'aria-activedescendant',
      row.id,
    );
  });

  it('renders only the rows in view of a large schema', async () => {
    // jsdom has no layout: give every element a 600px box.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
    server.use(
      http.get('/api/variables', () =>
        HttpResponse.json({ variables: manyVariables(1000) }),
      ),
    );
    await openVariables();

    expect(screen.getByText('1000 variables')).toBeInTheDocument();
    const rendered = rowNames();
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.length).toBeLessThan(60);
    expect(rendered[0]).toBe('VAR_0000');
    expect(screen.getByRole('grid', { name: 'Variables' })).toHaveAttribute(
      'aria-rowcount',
      // The column headers, ten group headings and the variables.
      String(1 + 10 + 1000),
    );
  });
});
