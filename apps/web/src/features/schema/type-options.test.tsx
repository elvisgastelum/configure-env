import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { mockState } from '../../mocks/store';
import { scenarios } from '../../mocks/handlers';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

type User = ReturnType<typeof userEvent.setup>;

async function openForm(name?: string) {
  server.use(...scenarios.schemaTypes);
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

/** Submits, saves the review, and gives the body of the one write. */
async function save(user: User, sheet: HTMLElement) {
  const writes = recordRequests('/api/schema/');
  await user.click(
    within(sheet).getByRole('button', { name: 'Review changes' }),
  );
  const review = await screen.findByRole('dialog', {
    name: /^(Add|Change) [A-Z]/,
  });
  await user.click(within(review).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(review).not.toBeInTheDocument());
  expect(screen.getAllByText('Saved env.schema.json').length).toBeGreaterThan(
    0,
  );
  return writes[0]?.[2] as Record<string, unknown>;
}

async function submitForErrors(user: User, sheet: HTMLElement) {
  await user.click(
    within(sheet).getByRole('button', { name: 'Review changes' }),
  );
}

describe('the type options', () => {
  it('writes every string option', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Name'), 'API_TOKEN');
    await fill(user, sheet, 'Minimum length', '8');
    await fill(user, sheet, 'Maximum length', '64');
    await user.type(box(sheet, 'Pattern'), '^sk_\\w+$');
    await user.type(box(sheet, 'Pattern message'), 'must be base64url');
    await pick(user, sheet, 'Encoding', 'base64url');
    await fill(user, sheet, 'Bytes', '32');
    expect((await save(user, sheet)).spec).toEqual({
      type: 'string',
      minLength: 8,
      maxLength: 64,
      pattern: '^sk_\\w+$',
      patternMessage: 'must be base64url',
      encoding: 'base64url',
      bytes: 32,
    });
  });

  it('tries the pattern live and refuses one that is not a regular expression', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Name'), 'KEY');
    await user.type(box(sheet, 'Pattern'), '^sk_');
    const tester = box(sheet, 'Try the pattern');
    await user.type(tester, 'sk_live');
    expect(
      within(sheet).getByText('The pattern matches this value.'),
    ).toBeVisible();
    await user.clear(tester);
    await user.type(tester, 'pk_live');
    expect(
      within(sheet).getByText('The pattern does not match this value.'),
    ).toBeVisible();

    await fill(user, sheet, 'Pattern', '(');
    expect(
      within(sheet).getByText(/^Not a valid regular expression: /),
    ).toBeVisible();
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText(
        'pattern is not a valid regular expression',
      ),
    ).toBeVisible();
    expect(box(sheet, 'Pattern')).toHaveAttribute('aria-invalid', 'true');
  });

  it('checks the string options against each other', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Name'), 'KEY');
    await fill(user, sheet, 'Bytes', '16');
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText('bytes needs encoding'),
    ).toBeVisible();
    await fill(user, sheet, 'Minimum length', '1.5');
    expect(
      await within(sheet).findByText('must be a whole number'),
    ).toBeVisible();
  });

  it('bounds an integer and a number', async () => {
    const { user, sheet: workers } = await openForm('WORKERS');
    let sheet = workers;
    await fill(user, sheet, 'Maximum', '128');
    expect(await save(user, sheet)).toEqual({
      fingerprint: 'schema-1',
      changes: { max: 128 },
    });

    await user.click(screen.getByRole('button', { name: 'Edit RATIO' }));
    sheet = await screen.findByRole('dialog', { name: 'Edit RATIO' });
    await fill(user, sheet, 'Minimum', '0.25');
    await fill(user, sheet, 'Maximum', '0.1');
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText('min must not exceed max'),
    ).toBeVisible();
    await fill(user, sheet, 'Maximum', '1');
    expect((await save(user, sheet)).changes).toEqual({ min: 0.25, max: 1 });
  });

  it('takes a negative or signed whole-number bound for an integer', async () => {
    const { user, sheet } = await openForm('WORKERS');
    await fill(user, sheet, 'Minimum', '-10');
    await fill(user, sheet, 'Maximum', '+5');
    expect((await save(user, sheet)).changes).toEqual({ min: -10, max: 5 });
  });

  it('refuses a fractional bound for an integer', async () => {
    const { user, sheet } = await openForm('WORKERS');
    await fill(user, sheet, 'Minimum', '-1.5');
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText('must be a whole number'),
    ).toBeVisible();
  });

  it('edits, reorders and removes the values of an enum', async () => {
    const { user, sheet } = await openForm('LOG_LEVEL');
    expect(box(sheet, 'Value 1')).toHaveValue('debug');
    expect(box(sheet, 'Value 2')).toHaveValue('info');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a value' }),
    );
    await user.type(box(sheet, 'Value 3'), 'info');
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText('values must not repeat'),
    ).toBeVisible();

    await fill(user, sheet, 'Value 3', 'warn');
    await user.click(
      within(sheet).getByRole('button', { name: 'Move value 3 up' }),
    );
    await user.click(
      within(sheet).getByRole('button', { name: 'Remove value 1' }),
    );
    expect((await save(user, sheet)).changes).toEqual({
      values: ['warn', 'info'],
    });
  });

  it('offers the enum values as the default', async () => {
    const { user, sheet } = await openForm('LOG_LEVEL');
    await pick(user, sheet, 'Default', 'debug');
    expect((await save(user, sheet)).changes).toEqual({ default: 'debug' });
  });

  it('lists the protocols of a URL', async () => {
    const { user, sheet } = await openForm('API_URL');
    expect(box(sheet, 'Protocols')).toHaveValue('https');
    await fill(user, sheet, 'Protocols', 'https, wss');
    expect((await save(user, sheet)).changes).toEqual({
      protocols: ['https', 'wss'],
    });
  });

  it('puts an address within a cidr variable', async () => {
    const { user, sheet } = await openForm('NODE_ADDRESS');
    await pick(user, sheet, 'Within', 'SERVICE_NETWORK');
    expect((await save(user, sheet)).changes).toEqual({
      within: 'SERVICE_NETWORK',
    });
  });

  it('refuses an IPv6 address within an IPv4 network, on the within field', async () => {
    const { user, sheet } = await openForm('LINK_LOCAL');
    await pick(user, sheet, 'Within', 'SERVICE_NETWORK');
    await submitForErrors(user, sheet);
    expect(
      await within(sheet).findByText(
        'SERVICE_NETWORK holds ipv4 blocks only, so LINK_LOCAL can never be within it',
      ),
    ).toBeVisible();
  });

  it.each([
    ['Family', 'SERVICE_NETWORK'],
    ['Encoding', 'API_KEY'],
  ] as const)(
    'marks the %s select invalid and points it at its error',
    async (label, variable) => {
      server.use(
        http.put('/api/schema/variables/:name', () =>
          HttpResponse.json(
            {
              statusCode: 422,
              message: 'the edit was refused; nothing was written',
              errors: [
                {
                  path: `variables.${variable}.${label.toLowerCase()}`,
                  message: `${label} is refused`,
                },
              ],
              schema: mockState.schema,
            },
            { status: 422 },
          ),
        ),
      );
      const { user, sheet } = await openForm(variable);
      await fill(user, sheet, 'Description', 'Changed.');
      await user.click(
        within(sheet).getByRole('button', { name: 'Review changes' }),
      );
      const review = await screen.findByRole('dialog', {
        name: `Change ${variable}`,
      });
      await user.click(within(review).getByRole('button', { name: 'Save' }));
      const error = await within(sheet).findByText(`${label} is refused`);
      const select = within(sheet).getByRole('combobox', { name: label });
      expect(select).toHaveAttribute('aria-invalid', 'true');
      expect(select.getAttribute('aria-describedby')?.split(' ')).toContain(
        error.id,
      );
    },
  );

  it('writes a cidr block’s family and strictness', async () => {
    const { user, sheet } = await openForm();
    await user.type(box(sheet, 'Name'), 'POD_NETWORK');
    await pick(user, sheet, 'Type', 'cidr');
    await pick(user, sheet, 'Family', 'IPv4');
    await user.click(within(sheet).getByRole('switch', { name: 'Strict' }));
    await pick(user, sheet, 'Within', 'SERVICE_NETWORK');
    expect((await save(user, sheet)).spec).toEqual({
      type: 'cidr',
      within: 'SERVICE_NETWORK',
      family: 'ipv4',
      strict: true,
    });
  });

  it.each(['boolean', 'email', 'host', 'port'])(
    'says a %s takes no other options',
    async (type) => {
      const { user, sheet } = await openForm();
      await pick(user, sheet, 'Type', type);
      expect(
        within(sheet).getByText(`A ${type} variable takes no other options.`),
      ).toBeVisible();
    },
  );
});

describe('switching the type', () => {
  it('asks before clearing the options the new type does not take', async () => {
    const { user, sheet } = await openForm('DB_PASSWORD');
    await pick(user, sheet, 'Type', 'email');
    let confirm = await screen.findByRole('dialog', {
      name: 'Switch to email?',
    });
    expect(
      within(
        within(confirm).getByRole('list', {
          name: 'Fields the switch clears',
        }),
      )
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Minimum length']);
    await user.click(
      within(confirm).getByRole('button', { name: 'Keep string' }),
    );
    expect(
      within(sheet).getByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('string');
    expect(box(sheet, 'Minimum length')).toHaveValue('12');

    await pick(user, sheet, 'Type', 'email');
    confirm = await screen.findByRole('dialog', { name: 'Switch to email?' });
    await user.click(
      within(confirm).getByRole('button', { name: 'Switch and clear them' }),
    );
    expect(
      within(sheet).getByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('email');
    expect(
      within(sheet).queryByRole('textbox', { name: 'Minimum length' }),
    ).not.toBeInTheDocument();
    expect((await save(user, sheet)).changes).toEqual({
      type: 'email',
      minLength: null,
    });
  });

  it('clears a default that is no value of the new type', async () => {
    const { user, sheet } = await openForm('PORT');
    await pick(user, sheet, 'Type', 'boolean');
    const confirm = await screen.findByRole('dialog', {
      name: 'Switch to boolean?',
    });
    expect(within(confirm).getByRole('listitem')).toHaveTextContent('Default');
    await user.click(
      within(confirm).getByRole('button', { name: 'Switch and clear them' }),
    );
    expect((await save(user, sheet)).changes).toEqual({
      type: 'boolean',
      default: null,
    });
  });

  it('switches at once when nothing would be lost', async () => {
    const { user, sheet } = await openForm('API_KEY');
    await pick(user, sheet, 'Type', 'host');
    expect(
      screen.queryByRole('dialog', { name: 'Switch to host?' }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).getByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('host');
  });
});
