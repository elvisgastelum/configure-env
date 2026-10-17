---
'@elvisgastelum/configure-env': minor
---

`init` runs through the configure-env API (`POST /api/schema/init`), with the same output, exit codes and files written, and `init --env <name>` writes a stored environment's schema on its server; in a terminal the types it shows are the ones that server inferred. Every MCP tool takes an optional `env`, passed on as `--env`: every tool but `apply` reaches that environment's server; `get_schema` and `update_schema` go through `GET` and the new `PUT /api/schema`; the server refuses there a schema that would unmask a value, as the tool did. The API's `POST /api/schema/init` takes `variables` and `preview` and answers `gitignore`, `GET /api/schema` answers the schema's `text`, and a schema write the CLI sends is recorded in the history as `cli`.
