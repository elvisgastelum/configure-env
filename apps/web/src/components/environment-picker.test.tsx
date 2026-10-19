import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sse } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { createI18n } from '../i18n';
import { GATEWAY_HOP, scenarios } from '../mocks/handlers';
import { emitChanged, eventClients } from '../mocks/store';
import { renderApp } from '../test/render';
import { server } from '../test/server';

/** Every path the portal requests from now on, in order. */
function recordPaths() {
  const paths: string[] = [];
  server.events.on('request:start', ({ request }) => {
    // The gateway mock's own request to /api/* is not the portal's.
    if (request.headers.has(GATEWAY_HOP)) return;
    paths.push(new URL(request.url).pathname);
  });
  return paths;
}

const header = () => screen.getByTestId('app-header');
const picker = () =>
  within(header()).findByRole('combobox', { name: 'Environment' });

/**
 * The gateway's events of an environment that does not answer, as long as
 * `down()` holds: a short `retry:`, one `unreachable` event, then the end.
 */
function downEvents(down: () => boolean) {
  return sse<{ unreachable: { message: string } }>(
    '/env/:name/api/events',
    ({ client }) => {
      if (!down()) {
        eventClients.add(client as never);
        return;
      }
      client.send({ retry: 20 });
      client.send({
        event: 'unreachable',
        data: {
          message:
            'environment dev at http://dev.internal:4000 is unreachable: ECONNREFUSED',
        },
      });
      client.close();
    },
  );
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await picker());
  await user.click(await screen.findByRole('option', { name }));
}

describe('the environment picker', () => {
  it('stays out of the header while serve has no other environment', async () => {
    await renderApp();
    expect(
      await within(header()).findByText('billing-service'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(header()).queryByRole('combobox', { name: 'Environment' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows local as the active environment and lists the others, an unreachable one disabled', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp();

    expect(await picker()).toHaveTextContent('local');
    await user.click(await picker());
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('local'),
      expect.stringContaining('dev'),
      expect.stringContaining('stage'),
      expect.stringContaining('prod'),
    ]);
    const stage = screen.getByRole('option', { name: /stage/ });
    expect(stage).toHaveAttribute('aria-disabled', 'true');
    expect(stage).toHaveTextContent('Unreachable');
  });

  it('sends every request through /env/<name>/api on switch, refetching the views', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp('/variables');
    expect(
      await within(header()).findByText('/home/ada/code/billing-service'),
    ).toBeInTheDocument();
    const paths = recordPaths();

    await choose(user, /dev/);

    expect(
      await within(header()).findByText('/srv/dev/billing-service'),
    ).toBeInTheDocument();
    expect(await picker()).toHaveTextContent('dev');
    await waitFor(() =>
      expect(paths).toEqual(
        expect.arrayContaining([
          '/env/dev/api/project',
          '/env/dev/api/variables',
          '/env/dev/api/events',
        ]),
      ),
    );
    // Only the list of environments stays on the local server.
    expect(
      paths.filter(
        (path) => path.startsWith('/api/') && path !== '/api/environments',
      ),
    ).toEqual([]);
  });

  it('listens to the chosen environment’s events', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp();
    await choose(user, /dev/);
    expect(
      await within(header()).findByText('/srv/dev/billing-service'),
    ).toBeInTheDocument();
    const paths = recordPaths();

    // Each event restarts the burst window: one is sent, once it listens.
    await waitFor(() => expect(eventClients.size).toBeGreaterThan(0));
    emitChanged(['.env']);
    await waitFor(() => {
      expect(
        paths.filter(
          (path) =>
            path.startsWith('/env/dev/api/') && path !== '/env/dev/api/events',
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(
      paths.filter(
        (path) => path.startsWith('/api/') && path !== '/api/environments',
      ),
    ).toEqual([]);
  });

  it('goes back to local', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp();
    await choose(user, /dev/);
    expect(
      await within(header()).findByText('/srv/dev/billing-service'),
    ).toBeInTheDocument();
    const paths = recordPaths();

    await choose(user, /local/);

    expect(
      await within(header()).findByText('/home/ada/code/billing-service'),
    ).toBeInTheDocument();
    expect(paths).toContain('/api/project');
    expect(paths.some((path) => path.startsWith('/env/'))).toBe(false);
  });

  it('marks prod apart from the other environments', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp();
    expect(await picker()).toHaveAttribute('data-production', 'false');

    await choose(user, /prod/);

    await waitFor(async () =>
      expect(await picker()).toHaveAttribute('data-production', 'true'),
    );
    expect(await picker()).toHaveAttribute('data-environment', 'prod');
    expect(
      within(header()).getByText('Production', { exact: false }),
    ).toBeInTheDocument();
  });

  it('hides Open in editor for another environment', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp('/variables');
    expect(
      (await screen.findAllByRole('button', { name: /in editor$/ })).length,
    ).toBeGreaterThan(0);

    await choose(user, /dev/);

    expect(
      await within(header()).findByText('/srv/dev/billing-service'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryAllByRole('button', { name: /in editor$/ }),
      ).toHaveLength(0),
    );
  });

  it('speaks Spanish', async () => {
    server.use(...scenarios.remoteEnvironments);
    const user = userEvent.setup();
    await renderApp('/', createI18n('es'));

    const select = await within(header()).findByRole('combobox', {
      name: 'Entorno',
    });
    await user.click(select);
    expect(
      await screen.findByRole('option', { name: /stage/ }),
    ).toHaveTextContent('No responde');
  });

  it('says the environment does not answer while its events retry, and clears it once it does', async () => {
    let down = true;
    server.use(
      downEvents(() => down),
      ...scenarios.remoteEnvironments,
    );
    const user = userEvent.setup();
    await renderApp();
    await choose(user, /dev/);

    const status = await within(header()).findByRole('status');
    expect(status).toHaveTextContent('Not answering; retrying…');
    expect(status).toHaveAttribute(
      'title',
      'environment dev at http://dev.internal:4000 is unreachable: ECONNREFUSED',
    );
    expect(await picker()).toHaveAttribute('data-reachable', 'false');

    down = false;
    await waitFor(
      () =>
        expect(within(header()).queryByRole('status')).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
    expect(await picker()).toHaveAttribute('data-reachable', 'true');
    expect(await picker()).toHaveTextContent('dev');
    await waitFor(() => expect(eventClients.size).toBeGreaterThan(0));
  });

  it('says so in Spanish', async () => {
    server.use(
      downEvents(() => true),
      ...scenarios.remoteEnvironments,
    );
    const user = userEvent.setup();
    await renderApp('/', createI18n('es'));
    await user.click(
      await within(header()).findByRole('combobox', { name: 'Entorno' }),
    );
    await user.click(await screen.findByRole('option', { name: /dev/ }));
    expect(await within(header()).findByRole('status')).toHaveTextContent(
      'No responde; reintentando…',
    );
  });
});
