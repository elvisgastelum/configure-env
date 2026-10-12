import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

async function openVariables(path = '/variables') {
  const user = userEvent.setup();
  const app = await renderApp(path);
  await screen.findByRole('grid', { name: 'Variables' });
  return { user, ...app };
}

const drawer = (name: string) => screen.findByRole('dialog', { name });

/** The value matrix as [file, status, value] rows. */
const matrix = (dialog: HTMLElement) =>
  within(within(dialog).getByRole('table', { name: 'Values by file' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((cell) => cell.textContent),
    );

describe('the variable drawer', () => {
  it('opens from a row and describes the variable', async () => {
    const { user } = await openVariables();

    await user.click(await screen.findByRole('button', { name: 'API_URL' }));
    const dialog = await drawer('API_URL');

    expect(within(dialog).getByText('Where the API lives.')).toBeVisible();
    expect(within(dialog).getByText('Without a trailing slash.')).toBeVisible();
    expect(within(dialog).getByText('url')).toBeVisible();
    expect(within(dialog).getByText('Required')).toBeVisible();
    const options = within(dialog).getByRole('definition', {
      name: 'Protocols',
    });
    expect(options).toHaveTextContent('https');
    expect(
      within(dialog).getByRole('definition', { name: 'Example' }),
    ).toHaveTextContent('https://api.example.com');
  });

  it('shows the default and the enum values', async () => {
    const { user } = await openVariables();

    await user.click(await screen.findByRole('button', { name: 'LOG_LEVEL' }));
    const dialog = await drawer('LOG_LEVEL');

    expect(
      within(dialog).getByRole('definition', { name: 'Default' }),
    ).toHaveTextContent('info');
    expect(
      within(dialog).getByRole('definition', { name: 'Values' }),
    ).toHaveTextContent('debuginfo');
    expect(
      within(dialog).getByRole('definition', { name: 'Comment' }),
    ).toHaveTextContent('debug logs every request.');
  });

  it('shows the value in every file the variable is listed in', async () => {
    const { user } = await openVariables();

    await user.click(await screen.findByRole('button', { name: 'PORT' }));
    const dialog = await drawer('PORT');

    expect(matrix(dialog)).toEqual([
      ['.env', 'OK', '8080'],
      ['.env.example', 'OK', '3000'],
      ['config/app.env', 'Missing', 'Not set'],
    ]);
  });

  it('links the rules to the variables they name', async () => {
    const { user } = await openVariables();

    await user.click(
      await screen.findByRole('button', { name: 'DB_PASSWORD' }),
    );
    let dialog = await drawer('DB_PASSWORD');
    const rules = within(dialog).getByRole('definition', {
      name: 'Must differ from',
    });
    await user.click(within(rules).getByRole('button', { name: 'API_KEY' }));

    dialog = await drawer('API_KEY');
    expect(matrix(dialog)).toEqual([['.env', 'MissingDrift', 'Not set']]);
    const unless = within(dialog).getByRole('definition', {
      name: 'Required unless',
    });
    expect(
      within(unless).getByRole('button', { name: 'DB_PASSWORD' }),
    ).toBeInTheDocument();
  });

  it('opens on the variable the palette jumped to', async () => {
    await renderApp('/variables?focus=PORT');

    expect(await drawer('PORT')).toBeInTheDocument();
  });

  it('opens the selected row with Enter and closes with Escape', async () => {
    const { user } = await openVariables('/variables');

    const grid = screen.getByRole('grid', { name: 'Variables' });
    await user.click(await screen.findByRole('row', { name: /^LOG_LEVEL/ }));
    grid.focus();
    await user.keyboard('{Enter}');
    expect(await drawer('LOG_LEVEL')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('row', { name: /^LOG_LEVEL/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
