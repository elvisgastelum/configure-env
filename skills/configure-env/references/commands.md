# configure-env commands

`configure-env <command> --help` prints each command's options. `apply` is the default command.

## Global options

Every command takes them.

| Option | Meaning |
| --- | --- |
| `--schema <path>` | the schema; default `env.schema.json` in the root |
| `--root <dir>` | the project root the schema's paths are relative to; default where the command was typed (`INIT_CWD` under a pnpm script, else the cwd) |
| `--state <path>` | the protected variables' state, relative to the root; default `.configure-env/state.json`; never a schema file or a path inside one (exit 2) |
| `--file <path>` | only this schema file; repeatable for `apply`, `check`, `list`, `validate`; `set`, `get`, `unset` take one. A path not in the schema exits 2 |
| `--ci` | never prompt; also on when `CI` is set and not `false`/`0` |
| `--json` | one JSON document on stdout, logs on stderr; never prompts |
| `--no-color` | plain output; `NO_COLOR` works too |
| `-h`, `--help` / `-v`, `--version` | help, version |

## Commands and their flags

| Command | Writes | Flags | What it does |
| --- | --- | --- | --- |
| `apply` | files, state | `--set KEY=VALUE`, `--generate KEY`, `--defer KEY`, `--replace-protected KEY` (all repeatable), `--prune` | writes each schema file by its policy; fixes mode drift (below). `--prune` removes the keys a merge or existing create-only file holds that the schema does not list for it, each with the `#` lines directly above it, and a pruned key's protected fingerprint; status `pruned keys: A, B` (`added keys: C; pruned keys: A, B` with both). Unattended, a value comes from `--set`, then `--generate`, then a non-empty env var of the same name, then the default. A missing required value, an invalid value or a broken rule between variables writes nothing (exit 1). Without a terminal it needs `--ci` or `--json` (else exit 2). |
| `check` | nothing | `--set KEY=VALUE`, `--use-env`, `--strict` | per file: missing, a generate file that differs, keys a merge file lacks, with `--strict` the keys `apply --prune` would remove (`unknown keys: A, B`), mode drift, invalid values (masked), broken rules, invalid lines, protected mismatches. Exit 1 on any. Compares generate files with `--set` and defaults only; `--use-env` adds the environment, as `apply --ci` would. |
| `validate` | nothing | `--strict` | current values: missing file, invalid lines, unset required keys, invalid values, broken rules, protected mismatches. An unknown key is a warning, an error with `--strict`. Templates: lines and key presence only. Exit 1 on any error. |
| `list` | nothing | none | per file and key: set (`yes`/`no`/`empty`), valid, value (secrets masked, cut at 40), description. Always exit 0. |
| `init` | schema, `.gitignore` | `--from <file>`, `--force` | writes `env.schema.json` (`$schema` set) inferred from `--from` or `.env.example` (types, comments, defaults; policy merge), else empty. An existing schema exits 2 without `--force`. Adds `.configure-env/` to `.gitignore`. `--ci` keeps the inferred types. |
| `set` | one file, state | `KEY=VALUE…`, `--prompt KEY`, `--generate KEY`, `--stdin KEY`, `--create`, `--allow-unknown`, `--allow-template`, `--replace-protected KEY` | edits keys in place (keeps `export`, spacing, inline comment), appends missing ones with their schema comment; every other byte and the file's mode stay. One invalid value or broken rule writes nothing (exit 1). A key not in the file's variables exits 1 without `--allow-unknown`; a missing file exits 1 without `--create` (created with the schema `mode`). `--prompt` needs a terminal (exit 2 with `--ci`/`--json`); a `KEY=VALUE` for the same key wins over it. A key given two other ways exits 2. Status per key: `updated`, `added`, `unchanged`. |
| `get` | nothing | `KEY`, `--reveal` | prints one value unquoted. Unset key exits 1. A secret exits 1 unless `--reveal`; with `--json` it is masked. Agents never pass `--reveal`. |
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

`requiredUnless`, `conflictsWith`, `distinctFrom` hold per file over its own keys, never in templates.

- `apply` and `set` refuse to write a file that breaks one, for rules naming a key they write (exit 1, `kind: "value"` with `keys` naming both). `set A_FILE= A=…` swaps an either-or pair in one call.
- `--generate` of a key whose `conflictsWith` partner the same file would hold (kept, given, from the env or a default) exits 2 before any value is made.
- `unset` does not check them. `validate`, `check`, `list` report them by key, never by value.

## Protected values

`protected: true` or `{ "reason" }`, on a `secret` variable.

- Once a non-template file holds a non-empty value, a different value (`set`, `apply`) or `unset` exits 2 and writes nothing: `KEY: is protected (<reason>); pass --replace-protected KEY to change it`. The same value is `unchanged`.
- A missing or empty key whose earlier value the state recorded takes only that value back, or empty (`--defer`). Anything else, such as `apply --generate` after `.env` was deleted, exits 2: `KEY was set on DATE; restore it from your backup, or pass --replace-protected KEY`. To restore, pipe the backup in: `<backup read> | configure-env set --ci --create --file .env --stdin KEY`.
- `--replace-protected KEY` (`set`, `unset`, `apply`; per key, no global force): a person types the key in a terminal; with `--ci`/`--json` the flag is enough. Output: `replaced protected KEY`. Never pass it without asking the user.
- State: `.configure-env/state.json`, mode 600 (directory 700), git-ignored, salted HMACs only. Written by `apply`, `set`, `unset` after the env files; never by `check`, `validate`, `list`. They report `KEY no longer matches the value recorded on DATE` (exit 1). It knows only this machine's history: a fresh clone has none; `git clean -fdx` deletes it.
- Lock: a run that writes or holds a protected value takes `state.json.lock` first. Held by another run, it waits 2 s, then exits 1 with nothing written: `held by process PID; try again`. A crashed run's lock is never taken over: `left by process PID, which is no longer running; remove it and try again`.
- A failed state write after the files were written makes the run exit 1 with a `file` error: `X was written; its protected values are not recorded`.

## Mode drift

`check` reports `mode 644, expected 600 (run configure-env apply to fix it)` when a file's mode differs from the schema `mode`.

- `apply` chmods an existing file whose content needs no change, under any policy (an existing create-only `.env` included): status `mode fixed (644 → 600)`, JSON action `mode`, `written: false`. It needs no value and never rewrites the file. As for a skipped file, protected values it holds are recorded under the lock; a file holding none takes no lock. The next run reports `skipped (exists)` or `unchanged`.
- It only removes permissions. A schema `mode` that would add one is refused for that file: `mode not loosened (400, schema says 600)`, a `file` error, exit 1; `check` then says `apply never adds a permission; chmod it by hand`.
- It never follows a symlink (`O_NOFOLLOW` + `fchmod`), ignores the umask, and stays inside the root. A template gets one only when it declares `mode`.
- A file whose content also changes is written with the schema `mode`; its JSON entry carries `mode`.

## JSON output

Errors never hold a value. Error `kind`: `value` (a value breaks its rules or a rule between variables, exit 1), `usage` (options misuse a key, exit 2), `file` (an unsafe path, a mode not loosened, a lock or state failure, exit 1), `protected` (a change to a protected value, with `reason`, exit 2). Each has `key` (or `path`) and `message`; a broken rule adds `keys`.

- `apply`: `{ command, ok, errors, files: [{ path, policy, action, status, addedKeys, prunedKeys, written, reason?, error?, mode?: { from, to } }], deferred, replaced?: [{ file, key }] }`. `action`: `create`, `update`, `mode`, `unchanged`, `skip`; `reason`: `exists`, `refused`, `loosens`. `deferred` lists keys written empty in written files; `[]` when nothing was written. A failure before writing prints the same document, exit 1 or 2.
- `check`: `{ command, ok, drift, errors, files: [{ path, policy, status, drift, missingKeys, unknownKeys, invalid: [{ key, message, shown }], rules: [{ rule, key, others, message }], invalidLines, protected: [{ kind, key, message, reason? }], mode?: { actual, expected }, error? }] }`; `status`: `current`, `missing`, `differs`, `missing-keys`, `refused`.
- `validate`: `{ command, ok, files: [{ path, template, exists, ok, errors, warnings }] }`; each problem has `key` or `line`, `message`, `keys` for a conflict, `kind: "protected"` (with `reason`) for a mismatch.
- `list`: `[{ file, key, set, valid, error, value | masked, description, unknown }]`; `valid` is `null` when not checked.
- `set`: `{ command, ok, file, keys: [{ key, status, value | masked, replaced? }] }`; `unset`: same with `{ key, status, replaced? }`.
- `init`: `{ command, ok, schema, from, variables, gitignore }`; `gitignore`: `created`, `added`, `present`.
- `get`: `{ key, set, value | masked }`; `{ key, set: false }` (exit 1) when unset.

Other usage errors (no schema, an unknown option) go to stderr only.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | drift, an invalid value or schema, a broken rule, a mode not loosened, a held lock, or a failed write |
| 2 | usage: a bad option, no schema (run `init`), no terminal without `--ci`, `init` over a schema without `--force`, a misused key, a change to a protected value |
| 130 | cancelled |
