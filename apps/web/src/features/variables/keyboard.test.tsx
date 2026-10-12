import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

async function openVariables() {
  const user = userEvent.setup();
  const app = await renderApp('/variables');
  await screen.findByRole('row', { name: /^PORT/ });
  return { user, ...app };
}

const selected = () =>
  document
    .querySelector('[data-variable][aria-selected="true"]')
    ?.getAttribute('data-variable');

describe('keyboard shortcuts', () => {
  it('focuses the search with /', async () => {
    const { user } = await openVariables();

    await user.keyboard('/');

    const search = screen.getByRole('searchbox', { name: 'Search variables' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
  });

  it('moves between rows with j and k', async () => {
    const { user } = await openVariables();

    await user.keyboard('j');
    expect(selected()).toBe('API_URL');
    await user.keyboard('jj');
    expect(selected()).toBe('DB_PASSWORD');
    await user.keyboard('k');
    expect(selected()).toBe('PORT');
    await user.keyboard('kkk');
    expect(selected()).toBe('API_URL');
    await user.keyboard('jjjjjjj');
    expect(selected()).toBe('LOG_LEVEL');
  });

  it('follows the filtered rows', async () => {
    const { user } = await openVariables();

    await user.click(screen.getByRole('button', { name: 'Secret' }));
    await user.keyboard('jj');

    expect(selected()).toBe('API_KEY');
  });

  it('leaves the letters alone while typing', async () => {
    const { user } = await openVariables();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search variables' }),
      'jk',
    );

    expect(selected()).toBeUndefined();
    expect(screen.getByRole('searchbox')).toHaveValue('jk');
  });

  it('copies the selected value with c', async () => {
    const { user } = await openVariables();

    await user.keyboard('jjc');

    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('8080'),
    );
    expect(
      await screen.findByText('Copied the value of PORT'),
    ).toBeInTheDocument();
  });

  it('edits the selected value with e', async () => {
    const { user } = await openVariables();

    await user.keyboard('jje');

    const dialog = await screen.findByRole('dialog', { name: 'PORT' });
    expect(
      within(dialog).getByRole('textbox', {
        name: 'New value of PORT in .env',
      }),
    ).toBeInTheDocument();
  });

  it('lists the shortcuts', async () => {
    await openVariables();

    const note = screen.getByRole('note', { name: 'Keyboard shortcuts' });
    const keys = [...note.querySelectorAll('kbd')].map(
      (kbd) => kbd.textContent,
    );
    expect(keys).toEqual(['/', 'j', 'k', 'c', 'e']);
    for (const word of ['search', 'move', 'copy', 'edit'])
      expect(note).toHaveTextContent(word);
  });
});
