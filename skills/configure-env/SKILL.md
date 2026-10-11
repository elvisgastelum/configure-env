---
name: configure-env
description: "Trigger: set up or configure env, .env files, add/change an env variable, secrets, env.schema.json, configure-env. Edit env files safely through the configure-env CLI."
license: MIT
metadata:
  author: "elvisgastelum"
  version: "1.0"
---

## Activation Contract

Use this skill whenever a task creates, reads, changes or checks env files (`.env`, `.env.example`, `*.env`) or `env.schema.json`, the source of truth for the files, their policies and the variables' rules. The CLI validates every value, writes atomically with the schema mode, and keeps every byte it does not change.

Invoke it as `pnpm exec configure-env` when `@elvisgastelum/configure-env` is a dependency, else `npx --yes @elvisgastelum/configure-env`, from the project root (or `--root <dir>`).

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
| No `env.schema.json` | `init --ci` (infers from `.env.example`), then fix types and mark secrets |
| First setup of a checkout | `apply --ci --json --generate <SECRET>... --defer <HUMAN_SECRET>...`; hand the `deferred` keys to the human |
| New variable | add it to the schema → `apply --ci --file .env.example` → `set` it in the real file |
| Variable removed from the schema | `apply --ci --prune` (ask first when the file holds real values) |
| Non-secret value | `set --ci --file .env KEY=VALUE` |
| Generated secret | `set --ci --file .env --generate KEY` (it keeps an existing value) |
| Key or key file (either-or) | `--generate` only the key while its `*_FILE` partner is unset |
| Vendor secret, manager known | `<manager read cmd> \| configure-env set --ci --file .env --stdin KEY` |
| Vendor secret, no manager | the user runs `configure-env set --file .env --prompt KEY` (Claude Code: `! <command>`) |
| Many values for a human | ask them to run `configure-env apply` (TUI) |
| CI or a review gate | `check --ci` and `validate --ci --file .env.example` |
| Mode drift reported by check | `apply --ci --file <path>` (chmod only; never loosens; on `mode not loosened`, ask the user) |
| `protected` exit 2 | ask the user; to restore after a deletion, pipe the backup into `set --ci --create --file .env --stdin KEY` |
| State lock held (exit 1) | retry once; `left by process …`: ask the user to remove the lock |

## Execution Steps

1. `validate --ci --json` and `list --ci --json` show what is missing or invalid.
2. Change the schema first for a new variable or rule; a broken schema exits 1, naming each problem.
3. Write with `apply` or `set`, following the gates.
4. Verify with `validate --ci` and `check --ci`: 0 ok, 1 a problem, 2 a usage error. Fix the cause the message names; do not retry blindly.

## Output Contract

Report each file and key with the CLI's status (`created`, `added`, `updated`, `mode fixed`, `unchanged`, `skipped`), secrets masked as printed, and every missing value with the exact command for the human. Never include a secret value.

## References

- `references/commands.md` — every command and flag, secrets, rules between variables, protected values, mode drift, JSON output and exit codes.
- `references/schema.md` — the schema format, file policies, `mode` and templates.
