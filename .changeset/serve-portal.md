---
'@elvisgastelum/configure-env': minor
---

`configure-env serve` starts the local portal for the project: `npx @elvisgastelum/configure-env serve` runs the API and the web app from the published package, with nothing else to install.

- It prints a one-line banner and a launch URL that holds a fresh per-run token, opens it in the browser when it runs in a terminal (`--open` and `--no-open` decide otherwise), and stops on Ctrl-C or SIGTERM with exit 0.
- It binds `127.0.0.1` on the first free port from 4747; `--port` and `--host` change them, and a host that is not loopback needs `--unsafe-expose`.
- `--json` prints `{ "command": "serve", "url", "port", "pid" }` for agents.
- The package now depends on the NestJS runtime the server needs; only `serve` loads it, so the other commands start as fast as before.
