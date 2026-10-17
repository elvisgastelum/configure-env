---
'@elvisgastelum/configure-env': minor
---

`check` runs through the configure-env API, with the same output and exit codes: through the project's running `serve` when `.configure-env/server.json` names a live one, else a server of its own on 127.0.0.1 for the run only. `configure-env env add <name> --url <url>` stores a configure-env server and its token (from `--token-env <VAR>` or stdin) in `.configure-env/environments.json`, mode 600; `env list` and `env remove` list and forget them, and no output holds a token. `check --env <name>` (or `CONFIGURE_ENV_ENV`) checks that environment's project on its server: `--root`, `--schema` and `--state` exit 2 there, a server of an incompatible version is refused naming both versions, and one it cannot reach exits 1 naming the environment. Every other command exits 2 for an environment other than `local`.
