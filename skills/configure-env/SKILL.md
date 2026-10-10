---
name: configure-env
description: "Trigger: set up or configure env, .env files, add/change an env variable, secrets, env.schema.json, configure-env. Edit env files safely through the configure-env CLI."
license: MIT
metadata:
  author: "elvisgastelum"
  version: "1.0"
---

## Activation Contract

Use this skill whenever a task creates, reads, changes or checks a project's env files (`.env`, `.env.example`, `*.env`), or touches `env.schema.json`. `env.schema.json` is the source of truth: it lists the files, their write policies and the variables with their rules. The CLI validates every value, writes files atomically with their mode, and keeps every byte it does not change.

Invoke it as `pnpm exec configure-env` (or `npx configure-env`) when the project has `@elvisgastelum/configure-env` as a dependency, else as `npx --yes @elvisgastelum/configure-env`. Run it from the project root, or pass `--root <dir>`.

## Hard Rules

- Pass `--ci` on every command. You have no terminal, so the interactive TUI exits 2. Add `--json` when you parse the output. Never fake a terminal.
- Never read env files directly (`cat`, `grep`, `Read`, `source`, `printenv`). Inspect them with `list --json`, `validate --json` and `check --ci --json`; these mask secrets.
- Never pass `get --reveal`. Never print, echo, log or summarize a secret value.
- Never put a secret in argv (`set KEY=VALUE`, `apply --set KEY=VALUE`, `KEY=value cmd`) or in any file you write. A secret goes in only through:
  1. `--generate KEY` for secrets the project makes itself (session, JWT, encryption, internal passwords);
  2. `--stdin KEY`, piped from a secret manager the user names, so the value never passes through you. Always pipe into it, never run it with a bare stdin; an empty pipe (a failed read) exits 1;
  3. the human, with the TUI (see Decision Gates).
- Never edit an env file by hand, with `sed` or with a heredoc; use `set` and `unset`.
- Never write real values into a template (`*.example`, `*.sample`, `*.template`); never pass `--allow-template` with a secret. Never stage or commit a non-template env file.
- Ask before `init --force`, `unset` of a secret, rotating a secret (`unset`, then `--generate`), or `--allow-unknown`.
- Never pass `--replace-protected` without asking the user; a `protected` exit 2 means restore the value from a backup, not replace it.
- Mark every credential `"secret": true` in the schema, and give the real env file `"mode": "600"`.

## Decision Gates

| Need | Do |
| --- | --- |
| No `env.schema.json` | `init --ci` (it infers from `.env.example`), then fix the types and mark the secrets |
| First setup of a checkout | `apply --ci --json --generate <SECRET>... --defer <HUMAN_SECRET>...`; hand the `deferred` keys to the human |
| New variable | add it to the schema → `apply --ci --file .env.example` → `set` it in the real file |
| Non-secret value | `set --ci --file .env KEY=VALUE` |
| Generated secret | `set --ci --file .env --generate KEY` (it keeps an existing value) |
| Key or key file (either-or) | `--generate` only the key when the `*_FILE` partner is unset; `validate --ci --json` reports `requiredUnless`/`conflictsWith` breaks |
| Vendor secret, manager known | `<manager read cmd> \| configure-env set --ci --file .env --stdin KEY` |
| Vendor secret, no manager | ask the user to run `configure-env set --file .env --prompt KEY` in their terminal (Claude Code: `! <command>`) |
| Many values for a human | ask them to run `configure-env apply` (TUI) |
| CI or a review gate | `check --ci` and `validate --ci --file .env.example` |

## Execution Steps

1. Run `validate --ci --json` and `list --ci --json` to see what is missing or invalid.
2. Change the schema first when a variable is new or its rules change. A broken schema exits 1 and names each problem.
3. Write with `apply` or `set`, following the gates above.
4. Verify with `validate --ci` and `check --ci`. Exit 0 means ok, 1 means a problem, 2 means a usage error. Read the message and fix the cause; do not retry blindly.

## Output Contract

Report each file and key with its status (`created`, `added`, `updated`, `unchanged`, `skipped`), with secrets masked as the CLI prints them. List every value still missing, with the exact command the human should run. Never include a secret value.

## References

- `references/commands.md` — commands, flags, JSON output and exit codes.
- `references/schema.md` — the schema format, file policies and templates.
