---
'@elvisgastelum/configure-env': minor
---

`list`, `get`, `set`, `unset` and `history` run through the configure-env API, with the same flags, output and exit codes: through the project's running `serve` when `.configure-env/server.json` names a live one, else a server of their own on 127.0.0.1 for the run only. With `--env <name>` (or `CONFIGURE_ENV_ENV`) they work on that environment's project on its server; `--root`, `--schema` and `--state` exit 2 there. `list` keeps secrets masked, `get` reveals a secret only with `--reveal`, `set --generate` makes the value on the server, and the history records the changes as the `cli`'s: the API records `cli` for a request carrying `X-Configure-Env-Client: cli`, `portal` otherwise. `GET /api/variables` also lists each file's keys as `list` shows them, and `POST /api/values/set` takes `allowUnknown`, `keepExisting` and `masked` and answers each key's masked value and a `stateError`.
