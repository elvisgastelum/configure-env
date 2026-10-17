import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';
import { secretValue } from '../../mocks/fixtures';
import { renderApp } from '../../test/render';

async function openVariables() {
  const user = userEvent.setup();
  const app = await renderApp('/variables');
  await screen.findByRole('row', { name: /^PORT/ });
  return { user, ...app };
}

const row = (name: string) =>
  screen.getByRole('row', { name: new RegExp(`^${name}`) });

async function copyFromRow(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  format: string,
) {
  await user.click(
    within(row(name)).getByRole('button', { name: `Copy ${name}` }),
  );
  await user.click(await screen.findByRole('menuitem', { name: format }));
}

const clipboard = () => navigator.clipboard.readText();

describe('copying', () => {
  it('copies the value, KEY=VALUE and export KEY=VALUE', async () => {
    const { user } = await openVariables();

    await copyFromRow(user, 'PORT', 'Value');
    await waitFor(async () => expect(await clipboard()).toBe('8080'));
    expect(
      await screen.findByText('Copied the value of PORT'),
    ).toBeInTheDocument();

    await copyFromRow(user, 'LOG_LEVEL', 'KEY=VALUE');
    await waitFor(async () =>
      expect(await clipboard()).toBe('LOG_LEVEL=debug'),
    );
    expect(
      await screen.findByText('Copied LOG_LEVEL as KEY=VALUE'),
    ).toBeInTheDocument();

    await copyFromRow(user, 'PORT', 'export KEY=VALUE');
    await waitFor(async () =>
      expect(await clipboard()).toBe('export PORT=8080'),
    );
  });

  it('reveals a secret through the API to copy it, and never shows it', async () => {
    const { user, queryClient } = await openVariables();

    await copyFromRow(user, 'DB_PASSWORD', 'KEY=VALUE');

    const plain = secretValue('.env', 'DB_PASSWORD');
    await waitFor(async () =>
      expect(await clipboard()).toBe(`DB_PASSWORD=${plain}`),
    );
    expect(screen.queryByText(plain)).not.toBeInTheDocument();
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain(plain);
  });

  it('says when there is no value to copy', async () => {
    const { user } = await openVariables();

    await copyFromRow(user, 'API_KEY', 'Value');

    expect(
      await screen.findByText('API_KEY is not set in .env'),
    ).toBeInTheDocument();
  });

  it('copies a whole group as dotenv', async () => {
    const { user } = await openVariables();

    await user.click(
      screen.getByRole('button', {
        name: 'Copy the Network group of .env as dotenv',
      }),
    );

    await waitFor(async () =>
      expect(await clipboard()).toBe('API_URL=localhost:4000\nPORT=8080\n'),
    );
    expect(
      await screen.findByText('Copied 2 values of the Network group'),
    ).toBeInTheDocument();
  });

  it('copies a whole file as dotenv from the drawer, secrets revealed', async () => {
    const { user } = await openVariables();
    await user.click(screen.getByRole('button', { name: 'PORT' }));
    const dialog = await screen.findByRole('dialog', { name: 'PORT' });

    await user.click(
      within(dialog).getByRole('button', { name: 'Copy PORT in .env' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'The whole file as dotenv' }),
    );

    await waitFor(async () =>
      expect(await clipboard()).toBe(
        [
          'API_URL=localhost:4000',
          'PORT=8080',
          `DB_PASSWORD=${secretValue('.env', 'DB_PASSWORD')}`,
          'LOG_LEVEL=debug',
          '',
        ].join('\n'),
      ),
    );
    expect(
      await screen.findByText('Copied 4 values of .env'),
    ).toBeInTheDocument();
  });

  it('copies the value of another file from the drawer', async () => {
    const { user } = await openVariables();
    await user.click(screen.getByRole('button', { name: 'PORT' }));
    const dialog = await screen.findByRole('dialog', { name: 'PORT' });

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Copy PORT in .env.example',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Value' }));

    await waitFor(async () => expect(await clipboard()).toBe('3000'));
  });
});
