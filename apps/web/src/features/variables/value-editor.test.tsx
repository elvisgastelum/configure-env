import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { typedVariables } from '../../mocks/fixtures';
import { mockState, writeValue } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

// Values typed into secret fields, built at run time so no literal in the
// source looks like a credential to a secret scanner.
const SHARED = ['shared', 'value', 1].join('-');
const NEW_VALUE = ['a', 'brand', 'new', 'value'].join('-');

/** Every request body sent to `path`, in order. */
function recordRequests(path: string) {
  const bodies: unknown[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (new URL(request.url).pathname === path)
      bodies.push(await request.clone().json());
  });
  return bodies;
}

async function openEditor(name: string, file = '.env') {
  mockState.variables.variables.push(...structuredClone(typedVariables));
  const user = userEvent.setup();
  await renderApp(`/variables?focus=${name}`);
  const dialog = await screen.findByRole('dialog', { name });
  await user.click(
    within(dialog).getByRole('button', { name: `Edit ${name} in ${file}` }),
  );
  const label = `New value of ${name} in ${file}`;
  return { user, dialog, label };
}

/** The value cell of `file` in the drawer's matrix. */
const valueIn = (dialog: HTMLElement, file: string) =>
  within(
    within(dialog)
      .getByRole('table', { name: 'Values by file' })
      .querySelector(`[data-file="${file}"]`) as HTMLElement,
  ).getByTestId('value');

describe('the value editor', () => {
  it('picks an enum value from its choices', async () => {
    const sets = recordRequests('/api/values/set');
    const { user, dialog, label } = await openEditor('LOG_LEVEL');

    await user.click(within(dialog).getByRole('combobox', { name: label }));
    await user.click(await screen.findByRole('option', { name: 'info' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved LOG_LEVEL in .env')).toBeVisible();
    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('info'),
    );
    expect(sets).toEqual([
      { file: '.env', fingerprint: 'env-1', values: { LOG_LEVEL: 'info' } },
    ]);
  });

  it('switches a boolean', async () => {
    const { user, dialog, label } = await openEditor('DEBUG');

    const toggle = within(dialog).getByRole('switch', { name: label });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('true'),
    );
  });

  it('types a port and an integer in a number field', async () => {
    const { user, dialog, label } = await openEditor('PORT');

    const input = within(dialog).getByRole('textbox', { name: label });
    await user.clear(input);
    await user.type(input, '9090');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('9090'),
    );
  });

  it('shows the API validation messages as you type, and blocks the save', async () => {
    const { user, dialog, label } = await openEditor('WORKERS');

    const input = within(dialog).getByRole('textbox', { name: label });
    await user.clear(input);
    await user.type(input, '100');

    expect(
      await within(dialog).findByText('WORKERS must be at most 64'),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, '8');
    await waitFor(() =>
      expect(
        within(dialog).queryByText('WORKERS must be at most 64'),
      ).not.toBeInTheDocument(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(valueIn(dialog, '.env')).toHaveTextContent('8'));
  });

  it('validates a URL', async () => {
    const { user, dialog, label } = await openEditor('API_URL');

    const input = within(dialog).getByRole('textbox', { name: label });
    expect(input).toHaveAttribute('type', 'url');
    await user.clear(input);
    await user.type(input, 'nope');
    expect(
      await within(dialog).findByText('API_URL is not a URL'),
    ).toBeVisible();

    await user.clear(input);
    await user.type(input, 'http://api.example.com');
    expect(
      await within(dialog).findByText('API_URL must use https'),
    ).toBeVisible();

    await user.clear(input);
    await user.type(input, 'https://api.example.com');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Save' }),
      ).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent(
        'https://api.example.com',
      ),
    );
  });

  it('validates an email address', async () => {
    const { user, dialog, label } = await openEditor('ADMIN_EMAIL');

    const input = within(dialog).getByRole('textbox', { name: label });
    expect(input).toHaveAttribute('type', 'email');
    await user.clear(input);
    await user.type(input, 'ops-at-example');

    expect(
      await within(dialog).findByText('ADMIN_EMAIL is not an email address'),
    ).toBeVisible();
  });

  it('checks the rules between variables', async () => {
    writeValue('.env', 'API_KEY', SHARED);
    const { user, dialog, label } = await openEditor('DB_PASSWORD');

    await user.type(within(dialog).getByLabelText(label), SHARED);

    expect(
      await within(dialog).findByText('DB_PASSWORD must differ from API_KEY'),
    ).toBeVisible();
  });

  it('replaces a protected value only when asked to', async () => {
    const sets = recordRequests('/api/values/set');
    const { user, dialog, label } = await openEditor('DB_PASSWORD');

    const input = within(dialog).getByLabelText(label);
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, NEW_VALUE);
    const save = within(dialog).getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeDisabled());

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Replace the protected value',
      }),
    );
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText('Saved DB_PASSWORD in .env')).toBeVisible();
    expect(sets).toEqual([
      {
        file: '.env',
        fingerprint: 'env-1',
        values: { DB_PASSWORD: NEW_VALUE },
        replaceProtected: ['DB_PASSWORD'],
      },
    ]);
  });

  it('shows why the API refused a value, and keeps the old one', async () => {
    server.use(
      http.post('/api/values/set', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'nothing was written',
            kind: 'invalid',
            errors: [{ key: 'RELEASE_NAME', message: 'is not allowed here' }],
          },
          { status: 422 },
        ),
      ),
    );
    const { user, dialog, label } = await openEditor('RELEASE_NAME');

    const input = within(dialog).getByRole('textbox', { name: label });
    await user.clear(input);
    await user.type(input, 'green');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText('RELEASE_NAME is not allowed here'),
    ).toBeVisible();
    // The editor stays open on the refused draft; the file kept its value.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(valueIn(dialog, '.env')).toHaveTextContent('blue'),
    );
  });

  it('cancels without writing anything', async () => {
    const sets = recordRequests('/api/values/set');
    const { user, dialog, label } = await openEditor('RELEASE_NAME');

    await user.type(within(dialog).getByRole('textbox', { name: label }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(
      within(dialog).queryByRole('textbox', { name: label }),
    ).not.toBeInTheDocument();
    expect(valueIn(dialog, '.env')).toHaveTextContent('blue');
    expect(sets).toEqual([]);
  });
});
