---
'@elvisgastelum/configure-env': minor
---

`configure-env serve` starts without a schema, and the portal inits one: the overview's "No schema yet" card has an **Init from .env.example** button.

- It writes the schema `configure-env init --ci` writes: inferred from `.env.example`, or empty without one, with `.configure-env/` added to `.gitignore`. It never replaces an existing schema.
- `serve` notes on stderr that the project has no schema yet; an invalid schema still exits 1.
- `POST /api/schema/init` adds `.configure-env/` to `.gitignore` too, as `init` does, and the CLI's `init` now shares its inference with the API through the core.
