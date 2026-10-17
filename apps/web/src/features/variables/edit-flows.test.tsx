import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { typedVariables } from '../../mocks/fixtures';
import { findFile, mockState, touchFile, writeValue } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

function recordRequests(path: string) {
  const bodies: unknown[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (new URL(request.url).pathname === path)
      bodies.push(await request.clone().json());
  });
  return bodies;
}

async function openDrawer(name: string) {
  mockState.variables.variables.push(...structuredClone(typedVariables));
  const user = userEvent.setup();
  await renderApp(`/variables?focus=${name}`);
  const dialog = await screen.findByRole('dialog', { name });
  return { user, dialog };
}

const valueIn = (dialog: HTMLElement, file: string) =>
  within(
    within(dialog)
      .getByRole('table', { name: 'Values by file' })
      .querySelector(`[data-file="${file}"]`) as HTMLElement,
  ).getByTestId('value');

/** The table row behind the drawer (the modal hides it from roles). */
const tableRow = (name: string) =>
  document.querySelector(`[data-variable="${name}"]`) as HTMLElement;

async function editTo(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: string,
  value: string,
) {
  await user.click(
    within(dialog).getByRole('button', { name: `Edit ${name} in .env` }),
  );
  const input = within(dialog).getByRole('textbox', {
    name: `New value of ${name} in .env`,
  });
  await user.clear(input);
  await user.type(input, value);
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

async function moreActions(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: string,
  action: string,
) {
  await user.click(
    within(dialog).getByRole('button', {
      name: `More actions for ${name} in .env`,
    }),
  );
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

describe('editing values', () => {
  it('shows a new value at once, and rolls it back when the write fails', async () => {
    let fail!: () => void;
    const failed = new Promise<void>((resolve) => (fail = resolve));
    server.use(
      http.post('/api/values/set', async () => {
        await failed;
        return HttpResponse.json(
          { statusCode: 503, message: 'the protected state is locked' },
          { status: 503 },
        );
      }),
    );
    const { user, dialog } = await openDrawer('RELEASE_NAME');

    await editTo(user, dialog, 'RELEASE_NAME', 'green');

    await waitFor(() =>
      expect(tableRow('RELEASE_NAME')).toHaveTextContent('green'),
    );
    fail();
    await waitFor(() =>
      expect(tableRow('RELEASE_NAME')).toHaveTextContent('blue'),
    );
    expect(
      await within(dialog).findByText(
        'RELEASE_NAME the protected state is locked',
      ),
    ).toBeVisible();
  });

  it('asks what to do when the file changed meanwhile, and saves on top', async () => {
    const sets = recordRequests('/api/values/set');
    server.use(
      http.post(
        '/api/values/set',
        () => {
          // Something else writes the file between the read and the save.
          writeValue('.env', 'PORT', '7070');
          touchFile('.env');
          return HttpResponse.json(
            {
              statusCode: 409,
              message: '.env changed since it was read',
              file: findFile('.env'),
            },
            { status: 409 },
          );
        },
        { once: true },
      ),
    );
    const { user, dialog } = await openDrawer('PORT');

    await editTo(user, dialog, 'PORT', '9090');

    const conflict = await screen.findByRole('dialog', {
      name: '.env changed since you opened it',
    });
    expect(
      await within(conflict).findByRole('definition', { name: 'Now' }),
    ).toHaveTextContent('7070');
    expect(
      within(conflict).getByRole('definition', { name: 'Yours' }),
    ).toHaveTextContent('9090');

    await user.click(
      within(conflict).getByRole('button', { name: 'Save yours on top' }),
    );

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('9090'),
    );
    expect(sets).toEqual([
      { file: '.env', fingerprint: 'env-1', values: { PORT: '9090' } },
      { file: '.env', fingerprint: '.env-2', values: { PORT: '9090' } },
    ]);
  });

  it('keeps the value the file has now when asked to', async () => {
    server.use(
      http.post(
        '/api/values/set',
        () => {
          writeValue('.env', 'PORT', '7070');
          touchFile('.env');
          return HttpResponse.json(
            { statusCode: 409, message: 'changed', file: findFile('.env') },
            { status: 409 },
          );
        },
        { once: true },
      ),
    );
    const { user, dialog } = await openDrawer('PORT');

    await editTo(user, dialog, 'PORT', '9090');
    const conflict = await screen.findByRole('dialog', {
      name: '.env changed since you opened it',
    });
    await user.click(
      within(conflict).getByRole('button', { name: 'Keep the file as is' }),
    );

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('7070'),
    );
  });

  it('generates a new secret value', async () => {
    const sets = recordRequests('/api/values/set');
    const { user, dialog } = await openDrawer('SESSION_KEY');

    await moreActions(user, dialog, 'SESSION_KEY', 'Generate a new value');

    expect(
      await screen.findByText('Generated a new value for SESSION_KEY in .env'),
    ).toBeVisible();
    expect(sets).toEqual([
      { file: '.env', fingerprint: 'env-1', generate: ['SESSION_KEY'] },
    ]);
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Reveal SESSION_KEY in .env',
      }),
    );
    expect(
      await within(dialog).findByText('session_key-generated-1'),
    ).toBeVisible();
  });

  it('only offers to generate a secret string', async () => {
    const { user, dialog } = await openDrawer('PORT');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'More actions for PORT in .env',
      }),
    );
    await screen.findByRole('menuitem', { name: 'Unset' });
    expect(
      screen.queryByRole('menuitem', { name: 'Generate a new value' }),
    ).not.toBeInTheDocument();
  });

  it('unsets a value once confirmed', async () => {
    const unsets = recordRequests('/api/values/unset');
    const { user, dialog } = await openDrawer('PORT');

    await moreActions(user, dialog, 'PORT', 'Unset');
    const confirm = await screen.findByRole('dialog', {
      name: 'Unset PORT in .env?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Unset' }));

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('Not set'),
    );
    expect(await screen.findByText('Unset PORT in .env')).toBeVisible();
    expect(unsets).toEqual([
      { file: '.env', fingerprint: 'env-1', keys: ['PORT'] },
    ]);
  });

  it('replaces a protected value on purpose when unsetting it', async () => {
    const unsets = recordRequests('/api/values/unset');
    const { user, dialog } = await openDrawer('DB_PASSWORD');

    await moreActions(user, dialog, 'DB_PASSWORD', 'Unset');
    const confirm = await screen.findByRole('dialog', {
      name: 'Unset DB_PASSWORD in .env?',
    });
    expect(confirm).toHaveTextContent('The database was created with it.');
    await user.click(within(confirm).getByRole('button', { name: 'Unset' }));

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('Not set'),
    );
    expect(unsets).toEqual([
      {
        file: '.env',
        fingerprint: 'env-1',
        keys: ['DB_PASSWORD'],
        replaceProtected: ['DB_PASSWORD'],
      },
    ]);
  });

  it('says why an unset failed, and puts the value back', async () => {
    server.use(
      http.post('/api/values/unset', () =>
        HttpResponse.json(
          { statusCode: 403, message: '.env leaves the project root' },
          { status: 403 },
        ),
      ),
    );
    const { user, dialog } = await openDrawer('PORT');

    await moreActions(user, dialog, 'PORT', 'Unset');
    const confirm = await screen.findByRole('dialog', {
      name: 'Unset PORT in .env?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Unset' }));

    expect(
      await screen.findByText(
        'Could not unset PORT: .env leaves the project root',
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('8080'),
    );
  });
});
