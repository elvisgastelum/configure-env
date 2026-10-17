import type { SchemaDocument } from '@configure-env/core/schema';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { scenarios } from '../../mocks/handlers';
import { mockState, writeSchema } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

type User = ReturnType<typeof userEvent.setup>;

async function openForm(name?: string) {
  const user = userEvent.setup();
  await renderApp('/schema');
  await screen.findByRole('list', { name: 'Variables in schema order' });
  await user.click(
    screen.getByRole('button', {
      name: name ? `Edit ${name}` : 'Add variable',
    }),
  );
  const sheet = await screen.findByRole('dialog', {
    name: name ? `Edit ${name}` : 'Add a variable',
  });
  return { user, sheet };
}

/** Picks `option` in the select or combobox named `label`. */
async function pick(
  user: User,
  scope: HTMLElement,
  label: string,
  option: string,
) {
  await user.click(within(scope).getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Submits the form and saves the review it opens. */
async function reviewAndSave(
  user: User,
  sheet: HTMLElement,
  title: string | RegExp = /^(Add|Change|Rename) [A-Z]/,
) {
  await user.click(
    within(sheet).getByRole('button', { name: 'Review changes' }),
  );
  const review = await screen.findByRole('dialog', { name: title });
  expect(
    within(review).getByRole('table', { name: 'Changes to env.schema.json' }),
  ).toBeVisible();
  await user.click(within(review).getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved env.schema.json');
  return review;
}

const saved = () => mockState.schema.document as SchemaDocument;

describe('the variable form', () => {
  it('adds a variable with its common fields and the files it joins', async () => {
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm();

    await user.type(
      within(sheet).getByRole('textbox', { name: 'Name' }),
      'SUPPORT_EMAIL',
    );
    await pick(user, sheet, 'Type', 'email');
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Description' }),
      'Where users write to.',
    );
    await pick(user, sheet, 'Group', 'Network');
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Comment' }),
      'Shown in emails.',
    );
    await user.click(within(sheet).getByRole('switch', { name: 'Required' }));
    await pick(user, sheet, 'Empty value', 'Never accepted');
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Example' }),
      'help@example.com',
    );
    await user.click(
      within(sheet).getByRole('checkbox', { name: '.env.example' }),
    );

    await reviewAndSave(user, sheet);
    expect(writes).toEqual([
      [
        'POST',
        '/api/schema/variables',
        {
          fingerprint: 'schema-1',
          name: 'SUPPORT_EMAIL',
          spec: {
            type: 'email',
            description: 'Where users write to.',
            group: 'Network',
            required: true,
            allowEmpty: false,
            comment: 'Shown in emails.',
            example: 'help@example.com',
          },
          files: ['.env.example'],
        },
      ],
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add a variable' }),
      ).not.toBeInTheDocument(),
    );
    expect(saved().files[1]?.variables).toContain('SUPPORT_EMAIL');
  });

  it('types the default by the variable type', async () => {
    server.use(...scenarios.schemaTypes);
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm('DEBUG');
    await pick(user, sheet, 'Default', 'true');
    await reviewAndSave(user, sheet);
    expect(writes[0]?.[2]).toEqual({
      fingerprint: 'schema-1',
      changes: { default: true },
    });
  });

  it('refuses a name that is taken or malformed, on the name field', async () => {
    const { user, sheet } = await openForm();
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.type(name, 'PORT');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    expect(
      await within(sheet).findByText('PORT is already declared'),
    ).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');

    await user.clear(name);
    await user.type(name, '2FA');
    expect(
      await within(sheet).findByText(/must start with a letter or underscore/),
    ).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: /^Add [A-Z0-9]/ }),
    ).not.toBeInTheDocument();
  });

  it('renames a variable and shows the references the rename rewrites', async () => {
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm('API_KEY');
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'PARTNER_KEY');
    expect(
      within(
        within(sheet).getByRole('list', {
          name: 'References a rename rewrites',
        }),
      )
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['DB_PASSWORD · distinctFrom']);

    await reviewAndSave(user, sheet, 'Rename API_KEY to PARTNER_KEY');
    expect(writes).toEqual([
      [
        'POST',
        '/api/schema/variables/API_KEY/rename',
        { fingerprint: 'schema-1', to: 'PARTNER_KEY' },
      ],
    ]);
    expect(saved().variables.DB_PASSWORD).toMatchObject({
      distinctFrom: 'PARTNER_KEY',
    });
  });

  it('keeps the draft and saves the rename alone when it failed after the change', async () => {
    server.use(
      http.post('/api/schema/variables/:name/rename', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'the edit was refused; nothing was written',
            errors: [
              {
                path: 'variables.HTTP_PORT',
                message: 'HTTP_PORT is declared already',
              },
            ],
            schema: mockState.schema,
          },
          { status: 422 },
        ),
      ),
    );
    const { user, sheet } = await openForm('PORT');
    const description = within(sheet).getByRole('textbox', {
      name: 'Description',
    });
    await user.clear(description);
    await user.type(description, 'The port it listens on.');
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'HTTP_PORT');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', {
      name: 'Change PORT',
    });
    await user.click(within(review).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Saved the changes to PORT, but the API refused the rename to HTTP_PORT. The form shows why.',
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Change PORT' }),
      ).not.toBeInTheDocument(),
    );
    // The change is written; the form keeps the draft and shows the reason.
    expect(saved().variables.PORT?.description).toBe('The port it listens on.');
    expect(name).toHaveValue('HTTP_PORT');
    expect(
      within(sheet).getByText('HTTP_PORT is declared already'),
    ).toBeVisible();

    // Once the name is free, the same draft saves the rename.
    server.resetHandlers();
    const writes = recordRequests('/api/schema/');
    await reviewAndSave(user, sheet);
    expect(writes.at(-1)).toEqual([
      'POST',
      '/api/schema/variables/PORT/rename',
      { fingerprint: expect.any(String), to: 'HTTP_PORT' },
    ]);
    expect(saved().variables.HTTP_PORT?.description).toBe(
      'The port it listens on.',
    );
  });

  it('says the change was saved when the rename then fails to reach the API', async () => {
    server.use(
      http.post('/api/schema/variables/:name/rename', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'the disk is full' },
          { status: 500 },
        ),
      ),
    );
    const { user, sheet } = await openForm('PORT');
    const description = within(sheet).getByRole('textbox', {
      name: 'Description',
    });
    await user.clear(description);
    await user.type(description, 'The port it listens on.');
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'HTTP_PORT');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', { name: 'Change PORT' });
    await user.click(within(review).getByRole('button', { name: 'Save' }));

    expect(
      await within(review).findByText(
        'The changes to PORT were saved, but renaming it to HTTP_PORT failed: the disk is full. The review now shows the rename alone; save again to retry it.',
      ),
    ).toBeVisible();
    expect(within(review).queryByText(/The edit was not saved/)).toBeNull();
    expect(saved().variables.PORT?.description).toBe('The port it listens on.');
    expect(mockState.schema.fingerprint).toBe('schema-2');

    // Saving again retries the rename alone, against the written schema.
    server.resetHandlers();
    const writes = recordRequests('/api/schema/');
    await user.click(within(review).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved env.schema.json');
    expect(writes).toEqual([
      [
        'POST',
        '/api/schema/variables/PORT/rename',
        { fingerprint: 'schema-2', to: 'HTTP_PORT' },
      ],
    ]);
    expect(saved().variables.HTTP_PORT?.description).toBe(
      'The port it listens on.',
    );
  });

  it('rebases a rename that went stale after its change was written', async () => {
    server.use(
      http.post('/api/schema/variables/:name/rename', () => {
        // Someone else writes the schema between the change and the rename.
        const document = structuredClone(saved());
        document.variables.API_URL!.description = 'Changed elsewhere.';
        writeSchema(document);
        return HttpResponse.json(
          { statusCode: 409, message: 'changed', schema: mockState.schema },
          { status: 409 },
        );
      }),
    );
    const { user, sheet } = await openForm('PORT');
    const description = within(sheet).getByRole('textbox', {
      name: 'Description',
    });
    await user.clear(description);
    await user.type(description, 'The port it listens on.');
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'HTTP_PORT');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', { name: 'Change PORT' });
    await user.click(within(review).getByRole('button', { name: 'Save' }));

    expect(
      await within(review).findByText(
        /env.schema.json changed since you opened it/,
      ),
    ).toBeVisible();
    expect(
      within(review).getByText(
        'The changes to PORT were saved, but renaming it to HTTP_PORT failed. The review now shows the rename alone; save again to retry it.',
      ),
    ).toBeVisible();
    // The cache ends on the schema as it is now, not the one the change wrote.
    await user.click(within(review).getByRole('tab', { name: 'Raw JSON' }));
    expect(within(review).getByText(/Changed elsewhere/)).toBeVisible();
    expect(mockState.schema.fingerprint).toBe('schema-3');

    server.resetHandlers();
    const writes = recordRequests('/api/schema/');
    await user.click(within(review).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved env.schema.json');
    expect(writes).toEqual([
      [
        'POST',
        '/api/schema/variables/PORT/rename',
        { fingerprint: 'schema-3', to: 'HTTP_PORT' },
      ],
    ]);
  });

  it('picks the rule variables from the other variables', async () => {
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm('API_KEY');

    expect(
      within(sheet).getByRole('button', { name: 'Remove DB_PASSWORD' }),
    ).toBeVisible();
    await user.click(
      within(sheet).getByRole('combobox', { name: 'Required unless' }),
    );
    // The variable itself is never offered.
    expect(
      screen.queryByRole('option', { name: 'API_KEY' }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'PORT' }));
    // The open list makes the rest of the sheet inert; close it first.
    await user.keyboard('{Escape}');
    await user.click(
      within(sheet).getByRole('button', { name: 'Remove DB_PASSWORD' }),
    );
    await pick(user, sheet, 'Conflicts with', 'LOG_LEVEL');
    await user.keyboard('{Escape}');
    await pick(user, sheet, 'Distinct from', 'DB_PASSWORD');
    await user.keyboard('{Escape}');

    await reviewAndSave(user, sheet);
    expect(writes[0]).toEqual([
      'PUT',
      '/api/schema/variables/API_KEY',
      {
        fingerprint: 'schema-1',
        changes: {
          requiredUnless: 'PORT',
          conflictsWith: 'LOG_LEVEL',
          distinctFrom: 'DB_PASSWORD',
        },
      },
    ]);
  });

  it('enables protected only for a secret, and drops it with the secret', async () => {
    const { user, sheet } = await openForm();
    const protectedSelect = within(sheet).getByRole('combobox', {
      name: 'Protected',
    });
    expect(protectedSelect).toBeDisabled();
    expect(
      within(sheet).getByText(/Only a secret can be protected/),
    ).toBeVisible();

    await user.click(within(sheet).getByRole('switch', { name: 'Secret' }));
    expect(protectedSelect).toBeEnabled();
    await pick(user, sheet, 'Protected', 'Protected, with a reason');
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Reason' }),
      'Data is encrypted with it.',
    );

    await user.click(within(sheet).getByRole('switch', { name: 'Secret' }));
    expect(protectedSelect).toHaveTextContent('Not protected');
    expect(protectedSelect).toBeDisabled();
    expect(
      within(sheet).queryByRole('textbox', { name: 'Reason' }),
    ).not.toBeInTheDocument();
  });

  it('writes a protected secret with its reason', async () => {
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm();
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Name' }),
      'MASTER_KEY',
    );
    await user.click(within(sheet).getByRole('switch', { name: 'Secret' }));
    await pick(user, sheet, 'Protected', 'Protected, with a reason');
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Reason' }),
      'Data is encrypted with it.',
    );
    await reviewAndSave(user, sheet);
    expect((writes[0]?.[2] as { spec: unknown }).spec).toEqual({
      type: 'string',
      secret: true,
      protected: { reason: 'Data is encrypted with it.' },
    });
  });

  it('removes protected when a protected secret stops being secret', async () => {
    const writes = recordRequests('/api/schema/');
    const { user, sheet } = await openForm('DB_PASSWORD');
    expect(
      within(sheet).getByRole('combobox', { name: 'Protected' }),
    ).toHaveTextContent('Protected, with a reason');
    await user.click(within(sheet).getByRole('switch', { name: 'Secret' }));
    await reviewAndSave(user, sheet);
    expect(writes[0]?.[2]).toEqual({
      fingerprint: 'schema-1',
      changes: { secret: null, protected: null },
    });
  });

  it('puts the API’s errors on the fields their paths name', async () => {
    server.use(
      http.put('/api/schema/variables/:name', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'the edit was refused; nothing was written',
            errors: [
              {
                path: 'variables.PORT.default',
                message: 'invalid default: must be at most 1024',
              },
              {
                path: 'variables.PORT.requiredUnless[0]',
                message: 'API_URL is not declared in variables',
              },
              { path: 'version', message: 'version must be 1' },
            ],
            schema: mockState.schema,
          },
          { status: 422 },
        ),
      ),
    );
    const { user, sheet } = await openForm('PORT');
    const fallback = within(sheet).getByRole('textbox', { name: 'Default' });
    await user.clear(fallback);
    await user.type(fallback, '2000');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', { name: 'Change PORT' });
    await user.click(within(review).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'The API refused the edit; nothing was written. The form shows why.',
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Change PORT' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(sheet).getByText('invalid default: must be at most 1024'),
    ).toBeVisible();
    expect(fallback).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(sheet).getByText('API_URL is not declared in variables'),
    ).toBeVisible();
    expect(within(sheet).getByText('version: version must be 1')).toBeVisible();
  });
});
