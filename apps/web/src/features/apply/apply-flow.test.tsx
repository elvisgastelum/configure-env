import type { VariableSpec } from '@configure-env/api-client';
import type { SchemaDocument } from '@configure-env/core/schema';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { everyActionPlan } from '../../mocks/fixtures';
import { findVariable, mockState } from '../../mocks/store';
import { renderApp, renderWithProviders } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';
import { ApplyDialog } from './apply-dialog';

/** The apply dialog, opened from the files page. */
async function openApply() {
  const user = userEvent.setup();
  await renderApp('/files');
  await user.click(await screen.findByRole('button', { name: 'Apply' }));
  const dialog = await screen.findByRole('dialog', { name: 'Apply' });
  return { user, dialog };
}

/** The section of the plan that shows `path`. */
const planFile = (dialog: HTMLElement, path: string) =>
  within(dialog).getByRole('region', { name: path });

const diffLines = (region: HTMLElement) =>
  [...region.querySelectorAll('tr[data-kind]')].map((row) => [
    row.getAttribute('data-kind'),
    row.querySelector('[data-text]')?.textContent ?? row.textContent,
  ]);

/** API_KEY's spec, with `rules` on top, as GET /api/variables reports it. */
function apiKeyRules(rules: Partial<VariableSpec>) {
  Object.assign(findVariable('API_KEY')!.spec, rules);
}

/** A response the test lets through when it calls `release`. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { opened, release };
}

/** The value prompts the dialog shows now, by variable. */
const prompts = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('group', { name: /^Value of / })
    .map((field) => field.getAttribute('aria-label'));

describe('apply flow', () => {
  it('prompts for each needed value with its default, and generates a secret', async () => {
    const requests = recordRequests('/api/plan');
    const { user, dialog } = await openApply();

    // Like the TUI: the keys the files take, in schema order, by group.
    const fields = await within(dialog).findAllByRole('group', {
      name: /^Value of /,
    });
    expect(fields.map((field) => field.getAttribute('aria-label'))).toEqual([
      'Value of PORT',
      'Value of API_KEY',
      'Value of LOG_LEVEL',
    ]);
    expect(within(dialog).getByText('Network')).toBeInTheDocument();
    expect(
      within(fields[0]!).getByRole('textbox', { name: 'PORT' }),
    ).toHaveValue('3000');
    expect(within(fields[2]!).getByRole('combobox')).toHaveTextContent('info');
    const key = within(fields[1]!).getByLabelText('API_KEY');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveValue('');

    await user.click(
      within(fields[1]!).getByRole('button', { name: 'Generate API_KEY' }),
    );
    const generated = (key as HTMLInputElement).value;
    expect(generated).toMatch(/^[A-Za-z0-9_-]{48}$/);

    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await within(dialog).findByRole('region', { name: '.env' });
    expect(requests.at(-1)).toEqual([
      'POST',
      '/api/plan',
      { values: { PORT: '3000', API_KEY: generated, LOG_LEVEL: 'info' } },
    ]);
    // The generated secret is never shown.
    expect(dialog).not.toHaveTextContent(generated);
    expect(diffLines(planFile(dialog, '.env'))).toContainEqual([
      'added',
      'API_KEY=••••••••',
    ]);
  });

  it('renders each action a file can take, with its unified diff', async () => {
    server.use(
      http.post('/api/plan', () => HttpResponse.json(everyActionPlan)),
    );
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );

    const created = await within(dialog).findByRole('region', {
      name: 'config/app.env',
    });
    expect(within(created).getByText('Create')).toBeInTheDocument();
    expect(diffLines(created)).toEqual([
      ['added', 'PORT=3000'],
      ['added', 'LOG_LEVEL=info'],
    ]);

    const updated = planFile(dialog, '.env');
    expect(within(updated).getByText('Update')).toBeInTheDocument();
    expect(within(updated).getByText('Adds API_KEY')).toBeInTheDocument();
    expect(diffLines(updated)).toEqual([
      ['same', 'PORT=8080'],
      ['removed', 'LOG_LEVEL=debug'],
      ['added', 'LOG_LEVEL=info'],
      ['added', 'API_KEY=••••••••'],
    ]);

    const mode = planFile(dialog, '.env.local');
    expect(within(mode).getByText('Mode only')).toBeInTheDocument();
    expect(within(mode).getByText('Mode 644 to 600')).toBeInTheDocument();

    const unchanged = planFile(dialog, '.env.example');
    expect(within(unchanged).getByText('Unchanged')).toBeInTheDocument();
    expect(within(unchanged).queryByRole('table')).not.toBeInTheDocument();

    const skipped = planFile(dialog, '.env.seed');
    expect(within(skipped).getByText('Skip')).toBeInTheDocument();
    expect(
      within(skipped).getByText(
        'Create-only and already there: it is never overwritten.',
      ),
    ).toBeInTheDocument();

    expect(
      within(dialog).getByText('3 files change, 2 stay as they are.'),
    ).toBeInTheDocument();
  });

  it('asks before writing, then applies and shows the result per file', async () => {
    const requests = recordRequests('/api/apply');
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByRole('region', { name: '.env' });

    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    const confirm = within(dialog).getByRole('alert');
    expect(confirm).toHaveTextContent('Write 2 files?');
    expect(confirm).toHaveTextContent('.env, config/app.env');
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(requests).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    await user.click(within(dialog).getByRole('button', { name: 'Write' }));

    const result = await within(dialog).findByRole('list', {
      name: 'Result per file',
    });
    expect(requests).toEqual([
      [
        'POST',
        '/api/apply',
        {
          values: { PORT: '3000', LOG_LEVEL: 'info' },
          fingerprint: expect.stringMatching(/^plan-/),
        },
      ],
    ]);
    const items = within(result)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      expect.stringContaining('.envUpdated'),
      expect.stringContaining('.env.exampleUnchanged'),
      expect.stringContaining('config/app.envCreated'),
    ]);
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '2 files written.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    const app = await screen.findByRole('article', { name: 'config/app.env' });
    await waitFor(() => expect(app).toHaveTextContent('Exists'));
  });

  it('lists the plan errors and does not apply', async () => {
    server.use(
      http.post('/api/plan', () =>
        HttpResponse.json({
          ...everyActionPlan,
          ok: false,
          errors: [
            { kind: 'value', key: 'API_URL', message: 'is not a URL' },
            { kind: 'file', path: '.env.seed', message: 'is a directory' },
          ],
        }),
      ),
    );
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );

    const errors = await within(dialog).findByRole('alert');
    expect(errors).toHaveTextContent('API_URL is not a URL');
    expect(errors).toHaveTextContent('.env.seed is a directory');
    expect(
      within(dialog).getByRole('button', { name: 'Apply…' }),
    ).toBeDisabled();
  });

  it('replaces a protected value only once asked to', async () => {
    const requests = recordRequests('/api/plan');
    server.use(
      http.post('/api/plan', async ({ request }) => {
        const body = (await request.json()) as { replaceProtected?: string[] };
        const replacing = body.replaceProtected?.includes('DB_PASSWORD');
        return HttpResponse.json({
          ...everyActionPlan,
          ok: Boolean(replacing),
          protected: replacing
            ? []
            : [
                {
                  file: '.env',
                  key: 'DB_PASSWORD',
                  message: 'is protected',
                  reason: 'The database was created with it.',
                },
              ],
        });
      }),
    );
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );

    expect(
      await within(dialog).findByText(
        'DB_PASSWORD in .env is protected (The database was created with it.)',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Apply…' }),
    ).toBeDisabled();

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Replace the protected values',
      }),
    );
    await waitFor(() =>
      expect(requests.at(-1)?.[2]).toEqual({
        values: { PORT: '3000', LOG_LEVEL: 'info' },
        replaceProtected: ['DB_PASSWORD'],
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Apply…' }),
      ).toBeEnabled(),
    );
  });

  it('shows the plan again when the files changed since it was shown', async () => {
    server.use(
      http.post('/api/apply', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'the plan changed since it was shown; nothing was written',
            plan: everyActionPlan,
          },
          { status: 409 },
        ),
      ),
    );
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByRole('region', { name: '.env' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    await user.click(within(dialog).getByRole('button', { name: 'Write' }));

    expect(
      await within(dialog).findByText(
        'The files changed since the plan was shown. This is the plan now; nothing was written.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('region', { name: '.env.seed' }),
    ).toBeInTheDocument();
  });
});

describe('apply values', () => {
  it('offers Generate only when the rules leave room for a strong secret', async () => {
    apiKeyRules({ maxLength: 8 });
    const { dialog } = await openApply();
    const key = await within(dialog).findByRole('group', {
      name: 'Value of API_KEY',
    });
    expect(
      within(key).queryByRole('button', { name: 'Generate API_KEY' }),
    ).not.toBeInTheDocument();
  });

  it('says why when no random value passes the rules', async () => {
    apiKeyRules({ pattern: '^[0-9]+$' });
    const { user, dialog } = await openApply();
    const key = await within(dialog).findByRole('group', {
      name: 'Value of API_KEY',
    });
    await user.click(
      within(key).getByRole('button', { name: 'Generate API_KEY' }),
    );
    const why = within(key).getByText(
      'No random value passes the rules of API_KEY; type one instead.',
    );
    expect(within(key).getByLabelText('API_KEY')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining(why.id),
    );
    expect(within(key).getByLabelText('API_KEY')).toHaveValue('');
  });
});

describe('apply plan', () => {
  it('shows the plan of the latest inputs, not a late answer for earlier ones', async () => {
    const slow = gate();
    server.use(
      http.post('/api/plan', async ({ request }) => {
        const body = (await request.json()) as { replaceProtected?: string[] };
        if (body.replaceProtected?.length) {
          await slow.opened;
          return HttpResponse.json({ ...everyActionPlan, protected: [] });
        }
        return HttpResponse.json({
          ...everyActionPlan,
          ok: false,
          protected: [
            { file: '.env', key: 'DB_PASSWORD', message: 'is protected' },
          ],
        });
      }),
    );
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByText('DB_PASSWORD in .env is protected');
    const replace = within(dialog).getByRole('checkbox', {
      name: 'Replace the protected values',
    });
    await user.click(replace); // asks with replaceProtected; answers late
    await user.click(replace); // asks without; answers at once
    await waitFor(() => expect(replace).not.toBeChecked());

    const answered = new Promise<void>((resolve) =>
      server.events.on('response:mocked', () => resolve()),
    );
    slow.release();
    await answered;
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(
      within(dialog).getByText('DB_PASSWORD in .env is protected'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Apply…' }),
    ).toBeDisabled();
  });

  it('drops the conflict notice once a new plan is built', async () => {
    server.use(
      http.post('/api/apply', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'the plan changed since it was shown; nothing was written',
            plan: everyActionPlan,
          },
          { status: 409 },
        ),
      ),
    );
    const notice =
      'The files changed since the plan was shown. This is the plan now; nothing was written.';
    const { user, dialog } = await openApply();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Preview' }),
    );
    await within(dialog).findByRole('region', { name: '.env' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    await user.click(within(dialog).getByRole('button', { name: 'Write' }));
    expect(await within(dialog).findByText(notice)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await within(dialog).findByRole('region', { name: '.env' });
    await waitFor(() =>
      expect(
        within(dialog).getByRole('region', { name: 'config/app.env' }),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).queryByText(notice)).not.toBeInTheDocument();
  });

  it('waits for the schema before asking for values', async () => {
    const schema = gate();
    const document = structuredClone(
      mockState.schema.document,
    ) as SchemaDocument;
    document.files.find((file) => file.path === '.env')!.values = {
      API_KEY: 'set-in-the-schema',
    };
    server.use(
      http.get('/api/schema', async () => {
        await schema.opened;
        return HttpResponse.json({ ...mockState.schema, document });
      }),
    );
    const plans = recordRequests('/api/plan');
    renderWithProviders(<ApplyDialog open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Apply' });
    await waitFor(() => expect(plans).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(prompts(dialog)).toEqual([]);
    expect(within(dialog).getByText('Reading the plan…')).toBeInTheDocument();

    schema.release();
    // A key the schema sets literally is not asked for.
    await waitFor(() =>
      expect(prompts(dialog)).toEqual(['Value of PORT', 'Value of LOG_LEVEL']),
    );
  });

  it('says so when the schema cannot be read', async () => {
    server.use(
      http.get('/api/schema', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'the schema could not be read' },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<ApplyDialog open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Apply' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not plan or apply: the schema could not be read',
    );
    expect(prompts(dialog)).toEqual([]);
  });
});
