import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

const OPEN = '/api/open-in-editor';

/** The bodies sent to POST /api/open-in-editor, in order. */
function openRequests() {
  const requests = recordRequests(OPEN);
  return () => requests.map(([, , body]) => body);
}

async function openDrawer(name: string) {
  const user = userEvent.setup();
  await renderApp('/variables');
  await user.click(await screen.findByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name });
  return { user, dialog };
}

describe('Open in editor buttons', () => {
  it("open a variable's definition in the schema from the drawer", async () => {
    const sent = openRequests();
    const { user, dialog } = await openDrawer('PORT');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Open the definition of PORT in env.schema.json in editor',
      }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([{ file: 'env.schema.json', key: 'PORT' }]),
    );
    expect(
      await screen.findByText('Opened env.schema.json:1 in your editor'),
    ).toBeVisible();
  });

  it("open a variable's entry in each env file of the drawer, at its line", async () => {
    const sent = openRequests();
    const { user, dialog } = await openDrawer('PORT');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Open PORT in .env in editor',
      }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([{ file: '.env', key: 'PORT' }]),
    );
    expect(
      await screen.findByText('Opened .env:3 in your editor'),
    ).toBeVisible();
    // config/app.env does not exist: nothing to open there.
    expect(
      within(dialog).queryByRole('button', {
        name: 'Open PORT in config/app.env in editor',
      }),
    ).not.toBeInTheDocument();
  });

  it('show a tooltip with the shortcut', async () => {
    const { user, dialog } = await openDrawer('PORT');

    await user.hover(
      within(dialog).getByRole('button', {
        name: 'Open PORT in .env in editor',
      }),
    );

    const tooltip = await screen.findByText('Open in editor');
    expect(tooltip).toBeVisible();
    expect(within(tooltip.parentElement!).getByText('o')).toBeVisible();
  });

  it("open a file's entries from the file detail", async () => {
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/files');
    const card = await screen.findByRole('article', { name: '.env' });
    await user.click(within(card).getByRole('button', { name: 'Open .env' }));
    const detail = await screen.findByRole('region', { name: '.env' });

    await user.click(
      within(detail).getByRole('button', { name: 'Open .env in editor' }),
    );
    await user.click(
      within(detail).getByRole('button', {
        name: 'Open LOG_LEVEL in .env in editor',
      }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([
        { file: '.env' },
        { file: '.env', key: 'LOG_LEVEL' },
      ]),
    );
  });

  it('open the validation items: a variable at its entry, a bad line at its line', async () => {
    server.use(...scenarios.everyProblem);
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/validate');

    await user.click(
      await screen.findByRole('button', {
        name: 'Open DB_PASSWORD in .env in editor',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Open line 6 of .env in editor' }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([
        { file: '.env', key: 'DB_PASSWORD' },
        { file: '.env', line: 6 },
      ]),
    );
  });

  it('open the drift items, but not in a file that does not exist', async () => {
    server.use(...scenarios.everyProblem);
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/check');

    await user.click(
      await screen.findByRole('button', {
        name: 'Open EXTRA in .env in editor',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Open line 6 of .env in editor' }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([
        { file: '.env', key: 'EXTRA' },
        { file: '.env', line: 6 },
      ]),
    );
    const missing = screen.getByRole('region', { name: 'config/app.env' });
    expect(
      within(missing).queryByRole('button', { name: /in editor$/ }),
    ).not.toBeInTheDocument();
  });

  it("open the schema's errors at their JSON path, or at the position of a syntax error", async () => {
    server.use(...scenarios.invalidSchema);
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/schema');

    await user.click(
      await screen.findByRole('button', {
        name: 'Open files[0].path in env.schema.json in editor',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Open line 2 of env.schema.json in editor',
      }),
    );

    await waitFor(() =>
      expect(sent()).toEqual([
        { file: 'env.schema.json', path: 'files[0].path' },
        { file: 'env.schema.json', line: 2, column: 14 },
      ]),
    );
  });

  it('explain in a toast when no editor was found', async () => {
    server.use(...scenarios.noEditor);
    const { user, dialog } = await openDrawer('PORT');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Open PORT in .env in editor',
      }),
    );

    expect(await screen.findByText('No editor found')).toBeVisible();
    expect(
      screen.getByText(
        'Set $LAUNCH_EDITOR, $VISUAL or $EDITOR, or open VS Code, Cursor, Zed or a JetBrains IDE, then try again.',
      ),
    ).toBeVisible();
  });

  it('say why when the API refuses the file', async () => {
    server.use(...scenarios.editorRefused);
    const { user, dialog } = await openDrawer('PORT');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Open PORT in .env in editor',
      }),
    );

    expect(
      await screen.findByText(
        'Could not open .env: .env: resolves outside the root through a symlink',
      ),
    ).toBeVisible();
  });
});

describe('the o shortcut', () => {
  it('opens the selected variable in the file the table shows', async () => {
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/variables');
    await screen.findByRole('row', { name: /^PORT/ });

    await user.keyboard('jj');
    await user.keyboard('o');

    await waitFor(() =>
      expect(sent()).toEqual([{ file: '.env', key: 'PORT' }]),
    );
  });

  it('opens the item that holds the focus', async () => {
    server.use(...scenarios.everyProblem);
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/validate');

    (
      await screen.findByRole('button', { name: 'Fix API_URL in .env' })
    ).focus();
    await user.keyboard('o');

    await waitFor(() =>
      expect(sent()).toEqual([{ file: '.env', key: 'API_URL' }]),
    );
  });

  it('opens the variable of the open drawer', async () => {
    const sent = openRequests();
    const { user } = await openDrawer('LOG_LEVEL');

    await user.keyboard('o');

    await waitFor(() =>
      expect(sent()).toEqual([{ file: 'env.schema.json', key: 'LOG_LEVEL' }]),
    );
  });

  it('does nothing while typing', async () => {
    const sent = openRequests();
    const user = userEvent.setup();
    await renderApp('/variables');
    await screen.findByRole('row', { name: /^PORT/ });
    await user.keyboard('jj');

    const search = screen.getByRole('searchbox', { name: 'Search variables' });
    await user.click(search);
    await user.keyboard('o');

    expect(search).toHaveValue('o');
    // Give a stray request the time to be sent.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent()).toEqual([]);
  });

  it('leaves the other shortcuts as they were', async () => {
    const user = userEvent.setup();
    await renderApp('/variables');
    await screen.findByRole('row', { name: /^PORT/ });

    await user.keyboard('jj');
    await user.keyboard('e');

    const dialog = await screen.findByRole('dialog', { name: 'PORT' });
    expect(
      within(dialog).getByRole('textbox', {
        name: 'New value of PORT in .env',
      }),
    ).toBeInTheDocument();
  });
});
