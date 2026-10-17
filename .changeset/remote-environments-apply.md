---
'@elvisgastelum/configure-env': minor
---

`apply`, the default command, runs through the configure-env API with the same prompts, masked plan, output and exit codes: `POST /api/plan` plans the run and `POST /api/apply` writes that plan by its fingerprint, through the project's running `serve` when there is one, else a server of its own on 127.0.0.1 for the run only. `apply --env <name>` (or `CONFIGURE_ENV_ENV`) plans and applies a stored environment's project on its server, writing only that server's files; `--root`, `--schema` and `--state` exit 2 there. A `--generate` value is made on the server and never leaves it. The API's plan and apply take `generate` and `defer` keys, as `apply --generate` and `--defer` do; given `defer`, they check the run as `configure-env apply` does. The history names the CLI for an apply the CLI made.
