import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { schemaDocument, typedVariables } from '../../mocks/fixtures';
import { mockState, plainValue, writeValue } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

/** The undo requests sent, as `METHOD path`. */
function recordUndos() {
  const sent: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith('/undo')) sent.push(`${request.method} ${pathname}`);
  });
  return sent;
}

async function openHistory(path = '/history') {
  const user = userEvent.setup();
  const app = await renderApp(path);
  await screen.findByRole('list', { name: 'Changes, newest first' });
  return { user, ...app };
}

/** The title of each change shown, in order. */
const titles = (scope: HTMLElement = document.body) =>
  within(scope)
    .getAllByRole('article')
    .map((entry) => within(entry).getByRole('heading').textContent);

const entry = (id: number) =>
  screen
    .getAllByRole('article')
    .find((article) =>
      within(article)
        .getByRole('heading')
        .textContent?.startsWith(`Change #${id}:`),
    )!;

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  select: string,
  option: string,
) => {
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('the history page', () => {
  it('lists every change newest first, each with its diff, secrets masked', async () => {
    const { user } = await openHistory();

    expect(titles()).toEqual([
      'Change #4: Schema edit env.schema.json',
      'Change #3: LOG_LEVEL in .env',
      'Change #2: DB_PASSWORD in .env',
      'Change #1: PORT in .env',
    ]);
    const logLevel = entry(3);
    expect(within(logLevel).getByText('Portal')).toBeVisible();
    expect(logLevel).toHaveTextContent('BeforeinfoAfterdebug');

    const secret = entry(2);
    expect(within(secret).getByText('CLI')).toBeVisible();
    expect(secret).toHaveTextContent('Beforenot setAfter••••');
    expect(
      within(secret).getByText('Secret: values are masked and never stored.'),
    ).toBeVisible();
    expect(
      within(secret).getByText(
        "Can't be undone: the value is secret and is never stored, so this change can't be undone",
      ),
    ).toBeVisible();
    expect(
      within(secret).queryByRole('button', { name: /Undo/ }),
    ).not.toBeInTheDocument();

    const schema = entry(4);
    expect(schema).toHaveTextContent(
      '4 variables, 3 files → 5 variables, 3 files',
    );
    await user.click(within(schema).getByText('Show the diff'));
    const diff = within(schema).getByRole('table', {
      name: 'Changes to env.schema.json',
    });
    expect(diff).toHaveTextContent('"LOG_LEVEL": {');
  });

  it('filters by who made the change, the variable, the file and the date', async () => {
    const { user, router } = await openHistory();

    await choose(user, 'Made in', 'CLI');
    await waitFor(() =>
      expect(titles()).toEqual([
        'Change #2: DB_PASSWORD in .env',
        'Change #1: PORT in .env',
      ]),
    );
    expect(router.state.location.search).toEqual({ actor: 'cli' });

    await user.type(screen.getByRole('textbox', { name: 'Variable' }), 'PORT');
    await waitFor(() => expect(titles()).toEqual(['Change #1: PORT in .env']));

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(titles()).toHaveLength(4));

    await choose(user, 'File', 'env.schema.json');
    await waitFor(() =>
      expect(titles()).toEqual(['Change #4: Schema edit env.schema.json']),
    );
    await choose(user, 'File', 'Every file');

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-10-15' },
    });
    await waitFor(() =>
      expect(titles()).toEqual([
        'Change #4: Schema edit env.schema.json',
        'Change #3: LOG_LEVEL in .env',
      ]),
    );
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-10-14' },
    });
    expect(
      await screen.findByText('No change matches these filters.'),
    ).toBeVisible();
  });

  it('opens filtered from the address', async () => {
    await openHistory('/history?key=PORT');
    await waitFor(() => expect(titles()).toEqual(['Change #1: PORT in .env']));
    expect(screen.getByRole('textbox', { name: 'Variable' })).toHaveValue(
      'PORT',
    );
  });

  it('undoes a change after a confirmation, and records the undo', async () => {
    const undos = recordUndos();
    const { user } = await openHistory();

    await user.click(
      within(entry(3)).getByRole('button', { name: 'Undo change #3' }),
    );
    let dialog = await screen.findByRole('dialog', {
      name: 'Undo this change?',
    });
    expect(dialog).toHaveTextContent(
      'LOG_LEVEL in .env goes back to its value before this change.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(undos).toEqual([]);

    await user.click(
      within(entry(3)).getByRole('button', { name: 'Undo change #3' }),
    );
    dialog = await screen.findByRole('dialog', { name: 'Undo this change?' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Undo change' }),
    );

    expect(await screen.findByText('Change undone')).toBeVisible();
    expect(undos).toEqual(['POST /api/history/3/undo']);
    expect(plainValue('.env', 'LOG_LEVEL')).toBe('info');
    await waitFor(() =>
      expect(titles()[0]).toBe('Change #5: LOG_LEVEL in .env'),
    );
    expect(entry(5)).toHaveTextContent('Undid change #3');
    expect(entry(5)).toHaveTextContent('BeforedebugAfterinfo');
  });

  it('explains a refused undo when the value changed since, writing nothing', async () => {
    const { user } = await openHistory();
    // Changed outside the portal after the change was recorded.
    writeValue('.env', 'LOG_LEVEL', 'info');

    await user.click(
      within(entry(3)).getByRole('button', { name: 'Undo change #3' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Undo this change?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Undo change' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Not undone: LOG_LEVEL in .env no longer holds the value this change wrote, so it was not undone; it changed after this change was made',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Undo change' }),
    ).toBeDisabled();
    expect(plainValue('.env', 'LOG_LEVEL')).toBe('info');
    expect(mockState.history).toHaveLength(4);
  });
});

describe('the toast after an edit', () => {
  it('undoes a value edit from its Undo action', async () => {
    mockState.variables.variables.push(...structuredClone(typedVariables));
    const user = userEvent.setup();
    await renderApp('/variables?focus=RELEASE_NAME');
    const dialog = await screen.findByRole('dialog', { name: 'RELEASE_NAME' });

    await user.click(
      within(dialog).getByRole('button', { name: 'Edit RELEASE_NAME in .env' }),
    );
    const input = within(dialog).getByRole('textbox', {
      name: 'New value of RELEASE_NAME in .env',
    });
    await user.clear(input);
    await user.type(input, 'green');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const toast = (
      await screen.findByText('Saved RELEASE_NAME in .env')
    ).closest('[data-sonner-toast]') as HTMLElement;
    expect(plainValue('.env', 'RELEASE_NAME')).toBe('green');
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Change undone')).toBeVisible();
    expect(plainValue('.env', 'RELEASE_NAME')).toBe('blue');
    expect(mockState.history[0]).toMatchObject({
      key: 'RELEASE_NAME',
      beforeValue: 'green',
      afterValue: 'blue',
      undoOf: 5,
    });
  });

  it('undoes a schema edit from its Undo action', async () => {
    const user = userEvent.setup();
    await renderApp('/schema');
    await screen.findByRole('list', { name: 'Variables in schema order' });
    await user.click(screen.getByRole('button', { name: 'Move PORT up' }));
    await user.click(screen.getByRole('button', { name: 'Review order' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Reorder the variables',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const toast = (await screen.findByText('Saved env.schema.json')).closest(
      '[data-sonner-toast]',
    ) as HTMLElement;
    expect(
      Object.keys(
        (mockState.schema.document as typeof schemaDocument).variables,
      ).slice(0, 2),
    ).toEqual(['PORT', 'API_URL']);
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Change undone')).toBeVisible();
    expect(
      Object.keys(
        (mockState.schema.document as typeof schemaDocument).variables,
      ),
    ).toEqual(Object.keys(schemaDocument.variables));
  });
});

describe('the variable drawer', () => {
  it("shows the variable's history in its own tab, linking to the page", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp('/variables?focus=LOG_LEVEL');
    const dialog = await screen.findByRole('dialog', { name: 'LOG_LEVEL' });

    await user.click(within(dialog).getByRole('tab', { name: 'History' }));
    const list = await within(dialog).findByRole('list', {
      name: 'Changes, newest first',
    });
    expect(titles(list)).toEqual(['Change #3: LOG_LEVEL in .env']);
    expect(
      within(list).getByRole('button', { name: 'Undo change #3' }),
    ).toBeEnabled();

    await user.click(
      within(dialog).getByRole('link', {
        name: 'Open the full history of LOG_LEVEL',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/history'),
    );
    expect(router.state.location.search).toEqual({ key: 'LOG_LEVEL' });
  });

  it('says when the variable has no change yet', async () => {
    const user = userEvent.setup();
    await renderApp('/variables?focus=API_URL');
    const dialog = await screen.findByRole('dialog', { name: 'API_URL' });
    await user.click(within(dialog).getByRole('tab', { name: 'History' }));
    expect(
      await within(dialog).findByText('No change to API_URL yet.'),
    ).toBeVisible();
  });
});
