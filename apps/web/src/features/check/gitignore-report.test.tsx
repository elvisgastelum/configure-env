import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { gitignoreProblems } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { mockState } from '../../mocks/store';
import { renderApp } from '../../test/render';
import { recordRequests } from '../../test/requests';
import { server } from '../../test/server';

const TITLE = 'What git could commit';
const section = () => screen.findByRole('region', { name: TITLE });
const items = (region: HTMLElement) =>
  within(within(region).getByRole('list')).getAllByRole('listitem');

/** The live report, holding the sample project's git-ignore problems. */
function withProblems() {
  server.use(...scenarios.liveReports);
  mockState.gitignore = structuredClone(gitignoreProblems);
}

describe('check page, git-ignore problems', () => {
  it('lists each problem with the lines its fix adds, counted as errors', async () => {
    withProblems();
    await renderApp('/check');
    const region = await section();
    expect(items(region).map((item) => item.textContent)).toEqual([
      '.configure-env does not keep the state out of git. Fixing adds state.db, state.db-journal, state.db-wal, state.db-shm, state.json to .configure-env/.gitignore.Fix',
      '.env is not git-ignored, so its values could be committed. Fixing adds /.env to .gitignore.Fix',
    ]);
    const summary = await screen.findByRole('region', { name: 'Summary' });
    const before = Number(/(\d+) errors?/.exec(summary.textContent!)![1]);
    expect(before).toBeGreaterThanOrEqual(2);
  });

  it('fixes one problem, and the report after drops it', async () => {
    withProblems();
    const requests = recordRequests('/api/check/gitignore');
    const user = userEvent.setup();
    await renderApp('/check');
    const region = await section();

    await user.click(within(region).getByRole('button', { name: 'Fix .env' }));
    expect(requests).toEqual([
      ['POST', '/api/check/gitignore', { paths: ['.env'] }],
    ]);
    await waitFor(() => expect(items(region)).toHaveLength(1));
    expect(items(region)[0]).toHaveTextContent('.configure-env');
    expect(
      await screen.findByText('Added /.env to .gitignore.'),
    ).toHaveAttribute('role', 'status');
  });

  it('fixes every problem at once, and the section goes', async () => {
    withProblems();
    const requests = recordRequests('/api/check/gitignore');
    const user = userEvent.setup();
    await renderApp('/check');
    const region = await section();

    await user.click(within(region).getByRole('button', { name: 'Fix all' }));
    expect(requests).toEqual([['POST', '/api/check/gitignore', {}]]);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: TITLE })).toBeNull(),
    );
    expect(
      await screen.findByText(
        'Created .configure-env/.gitignore with state.db, state.db-journal, state.db-wal, state.db-shm, state.json. Added /.env to .gitignore.',
      ),
    ).toHaveAttribute('role', 'status');
  });

  it('offers no fix for a .gitignore that is a symlink, saying so', async () => {
    withProblems();
    mockState.gitignore = mockState.gitignore.map((problem) => ({
      ...problem,
      blocked: 'symlink' as const,
    }));
    await renderApp('/check');
    const region = await section();
    expect(items(region)[1]).toHaveTextContent(
      '.gitignore is a symlink, so it is not written: add /.env to it yourself.',
    );
    expect(within(region).queryAllByRole('button')).toEqual([]);
  });

  it('says what stopped a fix', async () => {
    withProblems();
    server.use(
      http.post('/api/check/gitignore', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'cannot update .gitignore: EACCES' },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderApp('/check');
    const region = await section();
    await user.click(within(region).getByRole('button', { name: 'Fix .env' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'The fix failed: cannot update .gitignore: EACCES',
    );
    expect(items(region)).toHaveLength(2);
  });

  it('hides them under the warnings filter: they are errors', async () => {
    withProblems();
    const user = userEvent.setup();
    await renderApp('/check');
    await section();
    await user.click(screen.getByRole('button', { name: /^Warnings/ }));
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();
  });
});
