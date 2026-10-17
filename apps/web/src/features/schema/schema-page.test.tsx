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

const recordSchemaWrites = () => recordRequests('/api/schema/');

const variableOrder = () =>
  [
    ...screen
      .getByRole('list', { name: 'Variables in schema order' })
      .querySelectorAll('[data-variable]'),
  ].map((item) => item.getAttribute('data-variable'));

/** The diff rows of the open review that changed, as `kind: text`. */
const changedRows = (dialog: HTMLElement) =>
  [
    ...within(dialog)
      .getByRole('table', { name: 'Changes to env.schema.json' })
      .querySelectorAll(
        'tbody tr:not([data-kind="same"]):not([data-kind="skipped"])',
      ),
  ].map((row) => `${row.getAttribute('data-kind')}: ${row.textContent}`);

async function openPage() {
  const user = userEvent.setup();
  const app = await renderApp('/schema');
  await screen.findByRole('list', { name: 'Variables in schema order' });
  return { user, ...app };
}

describe('the schema page', () => {
  it('lists the variables in schema order and the files', async () => {
    const { user } = await openPage();
    expect(variableOrder()).toEqual([
      'API_URL',
      'PORT',
      'DB_PASSWORD',
      'API_KEY',
      'LOG_LEVEL',
    ]);
    await user.click(screen.getByRole('tab', { name: 'Files' }));
    const files = screen.getByRole('list', {
      name: 'Files the schema manages',
    });
    expect(
      [...files.querySelectorAll('[data-file]')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      '.envmergeevery variablemode 600',
      '.env.examplegenerate3 variablestemplate',
      'config/app.envgenerate2 variables',
    ]);
  });

  it('reorders the variables, reviews the diff and saves it', async () => {
    const writes = recordSchemaWrites();
    const { user } = await openPage();

    await user.click(screen.getByRole('button', { name: 'Move PORT up' }));
    expect(variableOrder().slice(0, 2)).toEqual(['PORT', 'API_URL']);
    await user.click(screen.getByRole('button', { name: 'Review order' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Reorder the variables',
    });
    expect(changedRows(dialog).length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole('tab', { name: 'Raw JSON' }));
    expect(within(dialog).getByText(/"PORT": \{/)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved env.schema.json')).toBeVisible();
    expect(writes).toEqual([
      [
        'PUT',
        '/api/schema/variable-order',
        {
          fingerprint: 'schema-1',
          order: ['PORT', 'API_URL', 'DB_PASSWORD', 'API_KEY', 'LOG_LEVEL'],
        },
      ],
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(variableOrder().slice(0, 2)).toEqual(['PORT', 'API_URL']);
    expect(screen.queryByText(/The order changed/)).not.toBeInTheDocument();
  });

  it('reports the references a removed variable leaves, and removes them too', async () => {
    const writes = recordSchemaWrites();
    const { user } = await openPage();

    await user.click(
      screen.getByRole('button', { name: 'Remove DB_PASSWORD' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove DB_PASSWORD?',
    });
    const references = within(confirm).getByRole('list', {
      name: 'References to DB_PASSWORD',
    });
    expect(
      within(references)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'API_KEY · requiredUnless',
      '.env.example · variables',
      '.env.example · values',
    ]);
    await user.click(
      within(confirm).getByRole('button', { name: 'Review removal' }),
    );

    const review = await screen.findByRole('dialog', {
      name: 'Remove DB_PASSWORD',
    });
    expect(changedRows(review).join('\n')).toContain('"DB_PASSWORD": {');
    await user.click(within(review).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved env.schema.json');
    expect(writes).toEqual([
      [
        'DELETE',
        '/api/schema/variables/DB_PASSWORD',
        { fingerprint: 'schema-1', cleanup: true },
      ],
    ]);
    const document = mockState.schema.document as SchemaDocument;
    expect(document.variables.API_KEY).not.toHaveProperty('requiredUnless');
    expect(document.files[1]).not.toHaveProperty('values');
  });

  it('counts the places that name a variable', async () => {
    const writes = recordSchemaWrites();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Remove LOG_LEVEL' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove LOG_LEVEL?',
    });
    // config/app.env lists it and comments on it.
    expect(within(confirm).getByText(/2 places name LOG_LEVEL/)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Remove API_URL' }));
    const second = await screen.findByRole('dialog', {
      name: 'Remove API_URL?',
    });
    expect(within(second).getByText(/1 place names API_URL/)).toBeVisible();
    expect(writes).toEqual([]);
  });

  it('names the variables a removed file leaves in no file', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('tab', { name: 'Files' }));
    await user.click(screen.getByRole('button', { name: 'Remove .env' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove .env?' });
    expect(
      within(
        within(confirm).getByRole('list', {
          name: 'Variables left in no file',
        }),
      )
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['API_KEY']);
    await user.click(
      within(confirm).getByRole('button', { name: 'Review removal' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Remove .env' }),
    ).toBeVisible();
  });

  it('rebases the edit on a schema that changed meanwhile, then saves', async () => {
    const writes = recordSchemaWrites();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Move LOG_LEVEL up' }));
    await user.click(screen.getByRole('button', { name: 'Review order' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Reorder the variables',
    });

    // Someone else changes the schema before the save.
    const document = structuredClone(
      mockState.schema.document,
    ) as SchemaDocument;
    document.variables.PORT!.description = 'Changed elsewhere.';
    writeSchema(document);

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        /env.schema.json changed since you opened it/,
      ),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('tab', { name: 'Raw JSON' }));
    expect(within(dialog).getByText(/Changed elsewhere/)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved env.schema.json');
    expect(
      writes.map(([, , body]) => (body as { fingerprint: string }).fingerprint),
    ).toEqual(['schema-1', 'schema-2']);
    const saved = mockState.schema.document as SchemaDocument;
    expect(saved.variables.PORT?.description).toBe('Changed elsewhere.');
    expect(Object.keys(saved.variables).at(-2)).toBe('LOG_LEVEL');
  });

  it('shows a refusal in the review when no form can show it', async () => {
    server.use(
      http.put('/api/schema/variable-order', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'the edit was refused; nothing was written',
            errors: [{ path: 'variables', message: 'the order lost PORT' }],
            schema: mockState.schema,
          },
          { status: 422 },
        ),
      ),
    );
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Move PORT up' }));
    await user.click(screen.getByRole('button', { name: 'Review order' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Reorder the variables',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The API refused the edit; nothing was written:',
    );
    expect(alert).toHaveTextContent('variablesthe order lost PORT');
    expect(
      screen.getByRole('dialog', { name: 'Reorder the variables' }),
    ).toBeVisible();
  });

  it('keeps the review open with the reason when a save fails', async () => {
    server.use(
      http.put('/api/schema/variable-order', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'the disk is full' },
          { status: 500 },
        ),
      ),
    );
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Move PORT up' }));
    await user.click(screen.getByRole('button', { name: 'Review order' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Reorder the variables',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        'The edit was not saved: the disk is full',
      ),
    ).toBeVisible();
  });

  it('shows the errors of an invalid schema and offers no editing', async () => {
    server.use(...scenarios.invalidSchema);
    await renderApp('/schema');
    expect(await screen.findByText('The schema has errors')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Open the schema' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Variables in schema order' }),
    ).not.toBeInTheDocument();
  });

  it('points at init when there is no schema', async () => {
    server.use(...scenarios.noSchema);
    await renderApp('/schema');
    expect(await screen.findByText('No schema yet')).toBeVisible();
  });
});
