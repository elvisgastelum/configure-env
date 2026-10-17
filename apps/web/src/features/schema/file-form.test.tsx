import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { mockState } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

type User = ReturnType<typeof userEvent.setup>;

async function openForm(path?: string) {
  const user = userEvent.setup();
  await renderApp('/schema');
  await screen.findByRole('list', { name: 'Variables in schema order' });
  await user.click(screen.getByRole('tab', { name: 'Files' }));
  await user.click(
    screen.getByRole('button', { name: path ? `Edit ${path}` : 'Add file' }),
  );
  const sheet = await screen.findByRole('dialog', {
    name: path ? `Edit ${path}` : 'Add a file',
  });
  return { user, sheet };
}

async function pick(
  user: User,
  scope: HTMLElement,
  label: string,
  option: string,
) {
  await user.click(within(scope).getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const box = (sheet: HTMLElement, name: string) =>
  within(sheet).getByRole('textbox', { name });

async function fill(
  user: User,
  sheet: HTMLElement,
  name: string,
  value: string,
) {
  await user.clear(box(sheet, name));
  if (value) await user.type(box(sheet, name), value);
}

const listed = (sheet: HTMLElement) =>
  [
    ...within(sheet)
      .getByRole('list', { name: 'Variables of the file, in output order' })
      .querySelectorAll('[data-variable]'),
  ].map((item) => item.getAttribute('data-variable'));

async function save(user: User, sheet: HTMLElement) {
  const writes = recordRequests('/api/schema/');
  await user.click(
    within(sheet).getByRole('button', { name: 'Review changes' }),
  );
  const review = await screen.findByRole('dialog', {
    name: /^(Add|Change) [.a-z]/,
  });
  await user.click(within(review).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(review).not.toBeInTheDocument());
  return writes[0];
}

describe('the file form', () => {
  it('adds a file with every option', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Path'), 'config/worker.env');
    expect(
      within(sheet).getByRole('radio', { name: /^generate/ }),
    ).toBeChecked();
    expect(
      within(sheet).getByText(
        'Append the keys it misses and keep everything else as it is.',
      ),
    ).toBeVisible();
    await user.click(within(sheet).getByRole('radio', { name: /^merge/ }));
    await user.type(box(sheet, 'Mode'), '640');
    await user.click(
      within(sheet).getByRole('switch', { name: 'Every variable' }),
    );
    for (const name of ['PORT', 'LOG_LEVEL', 'API_URL'])
      await pick(user, sheet, 'Add a variable to the file', name);
    await user.click(
      within(sheet).getByRole('button', { name: 'Move API_URL up' }),
    );
    expect(listed(sheet)).toEqual(['PORT', 'API_URL', 'LOG_LEVEL']);
    await user.type(box(sheet, 'Header'), 'The worker settings.');
    await user.type(box(sheet, 'Description'), 'Read by the worker.');
    await pick(user, sheet, 'Template', 'Never a template');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a value' }),
    );
    await pick(user, sheet, 'Variable of values row 1', 'PORT');
    await user.type(box(sheet, 'Value of row 1'), '9090');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a comment' }),
    );
    await pick(user, sheet, 'Variable of comments row 1', 'LOG_LEVEL');
    await user.type(box(sheet, 'Comment of row 1'), 'Worker logs.');

    expect(await save(user, sheet)).toEqual([
      'POST',
      '/api/schema/files',
      {
        fingerprint: 'schema-1',
        spec: {
          path: 'config/worker.env',
          policy: 'merge',
          variables: ['PORT', 'API_URL', 'LOG_LEVEL'],
          mode: '640',
          header: 'The worker settings.',
          description: 'Read by the worker.',
          template: false,
          values: { PORT: '9090' },
          comments: { LOG_LEVEL: 'Worker logs.' },
        },
      },
    ]);
  });

  it('reorders the file’s variables by dragging', async () => {
    const { user, sheet } = await openForm('config/app.env');
    expect(listed(sheet)).toEqual(['PORT', 'LOG_LEVEL']);
    const list = within(sheet).getByRole('list', {
      name: 'Variables of the file, in output order',
    });
    const [port, level] = [...list.querySelectorAll('li')];
    // jsdom has no DataTransfer; the handlers only set its fields.
    const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(level!, { dataTransfer });
    fireEvent.dragOver(port!, { dataTransfer });
    fireEvent.drop(port!, { dataTransfer });
    expect(listed(sheet)).toEqual(['LOG_LEVEL', 'PORT']);
    expect((await save(user, sheet))?.[2]).toEqual({
      fingerprint: 'schema-1',
      path: 'config/app.env',
      changes: { variables: ['LOG_LEVEL', 'PORT'] },
    });
  });

  it('refuses a path that is not a safe relative path', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Path'), '../secrets.env');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    expect(
      await within(sheet).findByText('must not contain `..` segments'),
    ).toBeVisible();
    expect(box(sheet, 'Path')).toHaveAttribute('aria-invalid', 'true');
    await fill(user, sheet, 'Path', '/etc/app.env');
    expect(
      await within(sheet).findByText('must be relative, not absolute'),
    ).toBeVisible();
    await fill(user, sheet, 'Path', '.env');
    expect(
      await within(sheet).findByText('duplicates the path of files[0]'),
    ).toBeVisible();
  });

  it('renames a file and changes its mode, checked as it is typed', async () => {
    const { user, sheet } = await openForm('.env.example');
    expect(box(sheet, 'Value of row 1')).toHaveValue('change-me');
    expect(
      within(sheet).getByRole('combobox', { name: 'Template' }),
    ).toHaveTextContent('By its name (now: yes)');
    await fill(user, sheet, 'Mode', '6000');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    expect(
      await within(sheet).findByText(
        'mode must be three octal digits, like "600"',
      ),
    ).toBeVisible();
    await fill(user, sheet, 'Mode', '644');
    await fill(user, sheet, 'Path', '.env.sample');
    expect((await save(user, sheet))?.[2]).toEqual({
      fingerprint: 'schema-1',
      path: '.env.example',
      changes: { path: '.env.sample', mode: '644' },
    });
  });

  it('refuses a value row for a variable the file does not hold, or twice', async () => {
    const { user, sheet } = await openForm('.env.example');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a value' }),
    );
    await pick(user, sheet, 'Variable of values row 2', 'DB_PASSWORD');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    expect(
      await within(sheet).findByText('DB_PASSWORD is listed twice'),
    ).toBeVisible();

    await user.click(
      within(sheet).getByRole('button', { name: 'Remove values row 2' }),
    );
    await user.click(
      within(sheet).getByRole('button', {
        name: 'Remove API_URL from the file',
      }),
    );
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a comment' }),
    );
    // A row may only name a variable the file holds; the list offers those.
    await user.click(
      within(sheet).getByRole('combobox', {
        name: 'Variable of comments row 1',
      }),
    );
    expect(
      screen.queryByRole('option', { name: 'API_URL' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'PORT' })).toBeVisible();
  });

  it('puts the API’s errors on the fields and rows they name', async () => {
    server.use(
      http.put('/api/schema/files', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'the edit was refused; nothing was written',
            errors: [
              {
                path: 'files[1].values.DB_PASSWORD',
                message: 'must not contain a line break',
              },
              { path: 'files[1].header', message: 'is too long' },
            ],
            schema: mockState.schema,
          },
          { status: 422 },
        ),
      ),
    );
    const { user, sheet } = await openForm('.env.example');
    await fill(user, sheet, 'Description', 'The example.');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', {
      name: 'Change .env.example',
    });
    await user.click(within(review).getByRole('button', { name: 'Save' }));
    expect(
      await within(sheet).findByText('must not contain a line break'),
    ).toBeVisible();
    expect(box(sheet, 'Value of row 1')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(sheet).getByText('is too long')).toBeVisible();
  });

  it('lists the API’s errors about other parts of the schema above the form', async () => {
    server.use(
      http.put('/api/schema/files', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'the edit was refused; nothing was written',
            errors: [
              {
                path: 'variables.PORT.default',
                message: 'invalid default: must be at most 1024',
              },
              { path: 'files[0].mode', message: 'another file is refused' },
            ],
            schema: mockState.schema,
          },
          { status: 422 },
        ),
      ),
    );
    const { user, sheet } = await openForm('.env.example');
    await fill(user, sheet, 'Description', 'The example.');
    await user.click(
      within(sheet).getByRole('button', { name: 'Review changes' }),
    );
    const review = await screen.findByRole('dialog', {
      name: 'Change .env.example',
    });
    await user.click(within(review).getByRole('button', { name: 'Save' }));
    const alert = await within(sheet).findByText(
      /variables\.PORT\.default: invalid default/,
    );
    expect(alert.closest('[role="alert"]')).toHaveTextContent(
      'The schema refuses this edit:variables.PORT.default: invalid default: must be at most 1024 files[0].mode: another file is refused',
    );
  });
});
