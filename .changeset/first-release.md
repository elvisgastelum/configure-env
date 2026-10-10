---
'@elvisgastelum/configure-env': minor
---

First release, 0.1.0: the `configure-env` CLI and its programmatic API.

- `apply`, `check` and `init` work from a versioned JSON schema (v1) of env files and variables, as an interactive TUI or with `--ci`.
- `set`, `get`, `unset`, `list` and `validate` edit and inspect single variables, keeping every other byte of the file.
- Template files (`*.example`, `*.sample`, `*.template`) never receive user, environment or prompted values.
- The JSON Schema ships as `@elvisgastelum/configure-env/schema.json` for editor support.
