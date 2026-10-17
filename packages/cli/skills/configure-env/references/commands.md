# configure-env commands

`configure-env <command> --help` prints each command's options. `apply` is the default command.

## Global options

Every command takes them, except `install`, which takes only `--root`, `--ci`, `--json`, `--no-color` and `-h` (any other option exits 2). `serve` uses `--schema`, `--root` and `--json`.

| Option | Meaning |
| --- | --- |
| `--schema <path>` | the schema; default `env.schema.json` in the root |
| `--root <dir>` | the project root the schema's paths are relative to; default where the command was typed (`INIT_CWD` under a pnpm script, else the cwd) |
| `--state <path>` | the protected variables' state, relative to the root; default `.configure-env/state.db`; never a schema file or a path inside one (exit 2) |
| `--file <path>` | only this schema file; repeatable for `apply`, `check`, `list`; `set`, `get`, `unset` take one. A path not in the schema exits 2 |
| `--ci` | never prompt; also on when `CI` is set and not `false`/`0` |
| `--json` | one JSON document on stdout, logs on stderr; never prompts |
| `--no-color` | plain output; `NO_COLOR` works too |
| `-h`, `--help` / `-v`, `--version` | help, version |

## Commands and their flags

| Command | Writes | Flags | What it does |
| --- | --- | --- | --- |
| `apply` | files, state | `--set KEY=VALUE`, `--generate KEY`, `--defer KEY`, `--replace-protected KEY` (all repeatable), `--prune` | writes each schema file by its policy; fixes mode drift (below). `--prune` removes the keys a merge or existing create-only file holds that the schema does not list for it, each with the `#` lines directly above it, and a pruned key's protected fingerprint (when the schema protects nothing, a state it cannot read or lock is a warning when keys are pruned, `fingerprints of pruned keys, if any, were kept`, not a failure); status `pruned keys: A, B` (`added keys: C; pruned keys: A, B` with both). Unattended, a value comes from `--set`, then `--generate`, then a non-empty env var of the same name, then the default. A missing required value, an invalid value or a broken rule between variables writes nothing (exit 1). Without a terminal it needs `--ci` or `--json` (else exit 2). |
| `check` | nothing; `.gitignore` files with `--fix` | `--set KEY=VALUE`, `--use-env`, `--strict`, `--fix` | one report by file in schema order, each problem an error or a warning, with its code: `missing-file` (any policy, create-only and templates too), `differs` (a generate file), `missing-key` (a merge file or a template), `mode`, `refused`, `invalid-line`, `invalid-value` (a required one unset or empty included; masked), `rule`, `protected`, and `unknown-key` (a warning, an error with `--strict`); then, in the report's `gitignore` list, each an error: `state-not-ignored` (the state folder's own `.gitignore` is missing or lacks a state file) and `file-not-ignored` (in a git work tree, a non-template env file git does not ignore). In a terminal it asks which to fix (all selected); `--fix` fixes without asking (`--ci`, `--json` too) and reports what remains after. A symlinked `.gitignore` is never written. A `missing-key` is not also an `invalid-value`. Templates: file, lines and keys only. Text: `path: <message>` per problem (`warning:` marked), `path: ok`, then `N errors, M warnings in K files` or `Everything is current.` Exit 1 on any error; warnings alone exit 0. Compares generate files with `--set` and defaults only; `--use-env` adds the environment, as `apply --ci` would. |
| `list` | nothing | none | per file and key: set (`yes`/`no`/`empty`), valid, value (secrets masked, cut at 40), description. Always exit 0. |
| `history` | nothing | none (`--file` exits 2) | the 20 latest changes in the history of edits, newest first: `ID`, `WHEN (UTC)`, `BY` (`cli`/`portal`), `CHANGE` (`set`, `unset`, `replace`, `schema`; an undo adds `(undid N)`), `FILE`, `KEY` (`-` for the schema), `BEFORE`, `AFTER` (previews cut at 30, a secret's masked, `-` when not set). Exit 0, or 1 when the history cannot be read. Undo stays in the portal; a secret's change can't be undone (its value is never stored). |
| `init` | schema, `.gitignore` | `--from <file>`, `--force` | writes `env.schema.json` (`$schema` set) inferred from `--from` or `.env.example` (types, comments, defaults; policy merge), else empty. An existing schema exits 2 without `--force`. Adds `.configure-env/` to `.gitignore`. `--ci` keeps the inferred types. |
| `set` | one file, state | `KEY=VALUE…`, `--prompt KEY`, `--generate KEY`, `--stdin KEY`, `--create`, `--allow-unknown`, `--allow-template`, `--replace-protected KEY` | edits keys in place (keeps `export`, spacing, inline comment), appends missing ones with their schema comment; every other byte and the file's mode stay. One invalid value or broken rule writes nothing (exit 1). A key not in the file's variables exits 1 without `--allow-unknown`; a missing file exits 1 without `--create` (created with the schema `mode`). `--prompt` needs a terminal (exit 2 with `--ci`/`--json`); a `KEY=VALUE` for the same key wins over it. A key given two other ways exits 2. Status per key: `updated`, `added`, `unchanged`. |
| `get` | nothing | `KEY`, `--reveal` | prints one value unquoted. Unset key exits 1. A secret exits 1 unless `--reveal`; with `--json` it is masked. Agents never pass `--reveal`. |
| `install skill` | skill folders, `.git/info/exclude` | `--scope project\|local\|user`, `--mode copy\|symlink`, `--agent claude\|agents` (repeatable), `--force` | installs the shipped `skills/configure-env` at `.claude/skills/configure-env` (`claude`, default) or `.agents/skills/configure-env` (`agents`) under: `project`, the git top level of the root, else the root (to commit); `local`, the same folder with its path added once to `.git/info/exclude` (exit 2 outside a git repository); `user`, the home folder. `copy` copies the folder (a fresh clone keeps it); `symlink` links to the package's folder (a junction on Windows; follows upgrades, breaks when an npx cache or `node_modules` goes). Every target is checked first: one that exists exits 2 and installs nothing, unless `--force`, which swaps a new one in, keeping the old one on failure (a link is removed, never what it points at), or it is what the mode would make: a symlink to the same folder, or with `copy` a folder identical to the skill (same files and bytes), reported `unchanged` and left as it is, `--force` or not. A previous skill `--force` could not put back or remove is named in the error or a `warning:` line. `local` trusts a `.git` folder or file (worktree, submodule, `--separate-git-dir`) only when it leads to a git dir (`HEAD`, `objects`, `refs`) and a worktree's or submodule's git dir names it back. With `--ci`, `--json` or no terminal, missing choices default to `project`, `copy`, `claude`. Status per skill: `installed`, `linked`, `unchanged`; `(…, replaced)` with `--force`; `excluded` when `local` added the entry. Ask before `--scope user` or `--force`. |
| `serve` | nothing (the portal may) | `--port <port>`, `--host <host>`, `--unsafe-expose`, `--open`, `--no-open` | starts the local portal (API and web app) for the project until SIGINT or SIGTERM, which exit 0; a signal before it listens exits 130. Prints a banner and the launch URL, which holds a fresh per-run token (the API also takes it as `Authorization: Bearer <token>`). Port: the first free one from 4747, `--port 0` any free one, a `--port` in use exits 1. Host: `127.0.0.1`; a non-loopback `--host` exits 2 without `--unsafe-expose`, and warns with it. Opens the browser only in a terminal (and not with `--json`); `--open` / `--no-open` decide. It starts without a schema too (a note on stderr): the portal's "No schema yet" card then offers **Init from .env.example**, which writes what `init --ci` writes; an invalid schema exits 1. Agents run `serve --json --no-open` in the background and stop it with SIGTERM to `pid`; never share the URL, and ask before `--unsafe-expose`. |
| `unset` | one file, state | `KEY…`, `--allow-template`, `--replace-protected KEY` | removes keys, plus the comment above only when it is exactly the schema comment, and the blank line that set them apart (no doubled, leading or trailing blank is left). Status `removed`, or `absent` (exit 0). Rules between variables are not checked. |

`set`, `get` and `unset` work on `--file`, else the only non-template schema file; with several, `--file` is required (exit 2, listing them). `set` and `unset` edit a template only with `--allow-template`.

## Secrets

- `--generate KEY` (`apply`, `set`): only `type: "string"` with `secret: true` (else exit 2); a random 48-character `[A-Za-z0-9_-]` value from `node:crypto`, fitted to `minLength`/`maxLength`; a `maxLength` under 16 exits 2 (use `--prompt` or `--stdin`). With `encoding`, it is `bytes` random bytes (default 32) in that encoding; `bytes` under 16 exits 2. Never printed.
- Reuse: it never replaces a set value. `set --generate` keeps a non-empty value (`unchanged`; a kept invalid one exits 1; `unset` first to rotate). `apply --generate` reuses the value a non-template file of the run holds, so every file gets the same secret; files holding different values exit 2, naming the files only. It is made only when a file of the run writes the key.
- `apply --generate` exits 2 for a key a chosen `generate`-policy file writes (it would rotate every run; pass `--file` to leave that file out), and for a key also given with `--set`.
- `--stdin KEY` (`set`): one value from piped stdin, one trailing newline stripped, always masked. A terminal stdin exits 2, so does `--prompt` with it. An empty value (a failed command in the pipe) exits 1 and writes nothing; so does input past 64 KiB. 60 s with no new input exits 2, even from a pipe that sends the value but never closes.
- `--generate` and `--stdin` never write a template, even with `--allow-template` (exit 2).
- `--defer KEY` (`apply`): a `required` or `requiredUnless` key with no value is written empty instead of failing, not prompted, and listed (`deferred: KEY (set it with configure-env set --file .env --prompt KEY)`). An optional or undeclared key, or one also given with `--set`/`--generate`, exits 2.
- Masking: `••••` plus the last 2 characters once a value is longer than 8; shorter ones are all bullets.

## Rules between variables

`requiredUnless`, `conflictsWith`, `distinctFrom`, `within` hold per file over its own keys, never in template files (the loader checks a template's `within` values instead, exit 1 naming both keys). `within` applies only when both values are set and valid: `WEB_ADDRESS: must be within APP_SUBNET`.

- `apply` and `set` refuse to write a file that breaks one, for rules naming a key they write (exit 1, `kind: "value"` with `keys` naming both). `set A_FILE= A=…` swaps an either-or pair in one call.
- `--generate` of a key whose `conflictsWith` partner the same file would hold (kept, given, from the env or a default) exits 2 before any value is made.
- `unset` does not check them. `check` and `list` report them by key, never by value.

## Protected values

`protected: true` or `{ "reason" }`, on a `secret` variable.

- Once a non-template file holds a non-empty value, a different value (`set`, `apply`) or `unset` exits 2 and writes nothing: `KEY: is protected (<reason>); pass --replace-protected KEY to change it`. The same value is `unchanged`.
- A missing or empty key whose earlier value the state recorded takes only that value back, or empty (`--defer`). Anything else, such as `apply --generate` after `.env` was deleted, exits 2: `KEY was set on DATE; restore it from your backup, or pass --replace-protected KEY`. To restore, pipe the backup in: `<backup read> | configure-env set --ci --create --file .env --stdin KEY`.
- `--replace-protected KEY` (`set`, `unset`, `apply`; per key, no global force): a person types the key in a terminal; with `--ci`/`--json` the flag is enough. Output: `replaced protected KEY`. Never pass it without asking the user.
- State: `.configure-env/state.db`, mode 600 (directory 700), a SQLite database, git-ignored (the directory gets its own `.gitignore` for the database, its `-journal`/`-wal`/`-shm` files and `state.json`), salted HMACs only for protected values. Written by `apply`, `set`, `unset` after the env files; never by `check`, `list`, `history`. It also holds the history of edits: every `set`, `unset`, `apply`, `init` and portal write records what it changed (a value the schema declares and does not mark secret in plain text so the portal can undo it; a secret's never, in any file, nor that of a key the schema does not declare, whose preview is masked too); a history it cannot write is a `warning:` line on stderr, never a failure. They report `KEY no longer matches the value recorded on DATE` (exit 1). It knows only this machine's history: a fresh clone has none; `git clean -fdx` deletes it. A `state.json` of an earlier version next to it is imported by the first write, then removed.
- Concurrency: a run that writes or holds a protected value takes the database's write transaction first. Held by another run, it waits 2 s, then exits 1 with nothing written: `in use by another run; try again`. A crashed run leaves nothing to remove.
- A failed state write after the files were written makes the run exit 1 with a `file` error: `X was written; its protected values are not recorded`.

## Mode drift

`check` reports `mode 644, expected 600 (run configure-env apply to fix it)` when a file's mode differs from the schema `mode`.

- `apply` chmods an existing file whose content needs no change, under any policy (an existing create-only `.env` included): status `mode fixed (644 → 600)`, JSON action `mode`, `written: false`. It needs no value and never rewrites the file. As for a skipped file, protected values it holds are recorded under the lock; a file holding none takes no lock. The next run reports `skipped (exists)` or `unchanged`.
- It only removes permissions. A schema `mode` that would add one is refused for that file: `mode not loosened (400, schema says 600)`, a `file` error, exit 1; `check` then says `apply never adds a permission; chmod it by hand`.
- It never follows a symlink (`O_NOFOLLOW` + `fchmod`), ignores the umask, and stays inside the root. A template gets one only when it declares `mode`.
- A file whose content also changes is written with the schema `mode`; its JSON entry carries `mode`.

## JSON output

Errors never hold a value. Error `kind`: `value` (a value breaks its rules or a rule between variables, exit 1), `usage` (options misuse a key, exit 2), `file` (an unsafe path, a mode not loosened, a lock or state failure, exit 1), `protected` (a change to a protected value, with `reason`, exit 2). Each has `key` (or `path`) and `message`; a broken rule adds `keys`.

- `apply`: `{ command, ok, errors, files: [{ path, policy, action, status, addedKeys, prunedKeys, written, reason?, error?, mode?: { from, to } }], deferred, replaced?: [{ file, key }], warnings?: [string] }`. `action`: `create`, `update`, `mode`, `unchanged`, `skip`; `reason`: `exists`, `refused`, `loosens`. `deferred` lists keys written empty in written files; `[]` when nothing was written. A failure before writing prints the same document, exit 1 or 2.
- `check`: `{ command, ok, summary: { errors, warnings, files, failing }, files: [{ path, policy, template, status, mode?: { actual, expected }, ok, problems: [{ severity, code, key?, keys?, line?, message, shown?, reason?, fix? }] }], gitignore: [{ severity, code, path, gitignore, entries, message, blocked? }], errors, fixed? }`; `fixed` (with `--fix`): `[{ gitignore, created, added }]`; `blocked`: `symlink`; `status`: `current`, `missing`, `differs`, `missing-keys`, `refused`; `severity`: `error`, `warning`; `fix`: `apply`, `prune`, `set`, absent when a person decides; `shown` is the masked invalid value; `keys` lists every key a broken rule names; `errors` are run errors (`kind`, `key` or `path`, `message`). `ok` is false on any error.
- `list`: `[{ file, key, set, valid, error?, value | masked, description, unknown? }]`; `valid` is `null` when not checked; `unknown: true` only for a key the schema does not list for the file.
- `set`: `{ command, ok, file, keys: [{ key, status, value | masked, replaced? }] }`; `unset`: same with `{ key, status, replaced? }`. A lock or state failure before writing (`keys: []`, nothing written) or a failed state write after the file prints it with `ok: false` and `errors: [{ kind: "file", path, message }]`, exit 1; other failures go to stderr only.
- `init`: `{ command, ok, schema, from, variables, gitignore }`; `gitignore`: `created`, `added`, `present`, or `symlink` (a symlinked `.gitignore` is left alone, with a warning on stderr).
- `history`: `{ command, ok, total, changes: [{ id, at, actor, file, key, operation, before, after, restorable, undoBlocker?, undoOf }] }`; `before`/`after` are previews (a secret's `••••`), `total` counts every change recorded.
- `serve`: one line once it listens, `{ command, url, port, pid }`; `url` is the launch URL with the token.
- `get`: `{ key, set, value | masked }`; `{ key, set: false }` (exit 1) when unset.
- `install`: `{ command, ok, source, skills: [{ agent, scope, mode, path, status, replaced, exclude?: { file, entry, status } }] }`; `path`, `source` and `exclude.file` are absolute; `exclude` only with `--scope local`, its `status` `added` or `present`. A run that fails part-way prints `ok: false`, `skills` holding only those installed before the failure (they stay), and `errors: [{ kind: "file", path, message }]` (exit 1); a failed `exclude` write leaves that skill without `exclude`. `warnings: [string]` (only when non-empty) names a previous skill `--force` swapped out but could not remove: delete it.

Other usage errors (no schema, an unknown option) go to stderr only.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | a `check` error (drift, an invalid value or line, a broken rule, a protected mismatch, a git-ignore problem), an invalid schema, a mode not loosened, a held lock, or a failed write (an `install` that fails part-way still reports the skills it installed) |
| 2 | usage: a bad option, no schema (run `init`), no terminal without `--ci`, `init` over a schema or `install` over a differing skill without `--force`, `install --scope local` outside a git repository (or with a `.git` that leads to no git dir, or whose worktree or submodule git dir names another work tree), a misused key, a change to a protected value |
| 130 | cancelled; for `serve`, a signal before the server listens |
