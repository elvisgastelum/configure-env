# configure-env

Configure, check and edit env files from a schema, interactively or in CI.

## Status

Pre-release; the schema-driven CLI is being built. The package is not on npm yet.

The planned CLI reads a JSON schema that lists the env files (their paths and write policies) and the variables (names, types and validation rules), then works from it:

| Command    | Purpose                                            |
| ---------- | -------------------------------------------------- |
| `apply`    | write the env files the schema describes           |
| `check`    | change nothing; report drift and exit 1 when found |
| `init`     | start a schema for a project                       |
| `set`      | set one variable                                   |
| `get`      | print one variable                                 |
| `unset`    | remove one variable                                |
| `list`     | list the variables and where they are set          |
| `validate` | validate the values against the schema             |

Each command runs as an interactive TUI for people, or with `--ci` for unattended runs. Once published, it will run without installing:

```sh
npx @elvisgastelum/configure-env apply
```

## Current usage

Today the CLI still carries the env layout of [elvisgastelum.com](https://github.com/elvisgastelum/elvisgastelum.com), the project it was extracted from. It writes the files into the current directory, or into `--root <dir>`:

```sh
pnpm install
pnpm start -- --help
pnpm start -- --ci --root ../my-project
```

## Development

Requirements: Node.js 22 or later (see `.node-version`) and pnpm 12 (pinned in `package.json` through `packageManager`; `corepack enable` provides it).

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | run the CLI from source with tsx            |
| `pnpm start`        | same as `pnpm dev`                          |
| `pnpm lint`         | lint with ESLint                            |
| `pnpm format`       | format with Prettier                        |
| `pnpm format:check` | check the formatting without changing files |
| `pnpm typecheck`    | type-check with `tsc`                       |
| `pnpm test`         | run the tests with Vitest                   |

CI runs lint, format:check, typecheck and test on every pull request and on every push to `main`.

## License

[MIT](LICENSE)
