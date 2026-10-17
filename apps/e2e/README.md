# @configure-env/e2e

End-to-end and accessibility tests of the portal. Playwright drives Chromium
against the real `configure-env serve`, started from source on a fixture
project, and `@axe-core/playwright` scans every page.

## Prerequisites

1. Dependencies: `pnpm install`.
2. Chromium for Playwright, once per machine:
   `pnpm --filter @configure-env/e2e exec playwright install chromium`
   (add `--with-deps` on a fresh Linux CI runner).
3. Nothing to build by hand: the suite's global setup runs
   `pnpm --filter @configure-env/web build` before every run, and serve, run
   from source, serves that `apps/web/dist` ahead of the copy in
   `packages/cli/dist/web` an earlier `pnpm build` left.

## Run

| Command                                                   | What it does                         |
| --------------------------------------------------------- | ------------------------------------ |
| `pnpm e2e`                                                | The whole suite, both projects       |
| `pnpm e2e --project chromium`                             | Desktop Chromium only                |
| `pnpm e2e tests/schema.spec.ts`                           | One spec file                        |
| `pnpm e2e --ui`                                           | Playwright's UI mode                 |
| `pnpm --filter @configure-env/e2e exec playwright show-report` | The HTML report of the last run |

There is no `test` script on purpose: the root `pnpm test` runs Vitest in
every package, and the e2e suite runs on its own (`pnpm e2e`).

Projects (`playwright.config.ts`):

- `chromium`: every test at 1280×800, unless a test sets its own viewport.
- `reduced-motion`: the tests tagged `@smoke` again with
  `reducedMotion: 'reduce'`.

The HTML report goes to `playwright-report/` and traces (on the first retry
in CI) to `test-results/`; both are ignored by git.

## How the harness works

- `src/serve.ts` copies a fixture from `fixtures/` into a new
  `os.tmpdir()` directory, writes the env files that are not committed, then
  spawns `node --import tsx packages/cli/src/cli.ts serve --json --no-open
  --port 0` with `TSX_TSCONFIG_PATH=apps/api/tsconfig.json`, in that
  directory. It reads the first stdout line
  (`{"command":"serve","url":…,"port":…,"pid":…}`) and stops serve with
  SIGTERM, then SIGKILL if it does not exit.
- `src/fixtures.ts` gives each test `served` (the running server, its
  directory and helpers to read and write project files) and `portal` (the
  page, signed in through the launch URL). Every test has its own server on
  its own port and its own copy, so tests run in parallel. A test picks the
  fixture with `test.use({ fixture: 'empty' })`; the default is `portfolio`.
- Tests find elements by role and accessible name, in English
  (`locale: 'en-US'`).

## Fixtures

- `portfolio/`: `packages/cli/examples/portfolio.env.schema.json` plus one
  secret, `CONTACT_API_TOKEN`. `.env.example` misses `WEB_PORT` (check
  reports drift), `deploy/.env.production.example` does not exist (apply
  creates it), and `.env` is written at run time: git ignores it, it holds
  an invalid `VITE_CONTACT_WHATSAPP` (validate reports it), and its secret is
  random per run, never a committed literal.
- `empty/`: only a `.env.example`, for the init journey.
