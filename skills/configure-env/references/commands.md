# configure-env commands

`configure-env <command> --help` prints the full options of each command.

## Global options

| Option | Meaning |
| --- | --- |
| `--ci` | never prompt; also on when `CI` is set (not `false`/`0`) |
| `--json` | one JSON document on stdout, logs on stderr; implies no prompts |
| `--schema <path>` | the schema; default `env.schema.json` in the root |
| `--root <dir>` | the project root; default `INIT_CWD`, else the cwd |
| `--file <path>` | only this schema file; `set`, `get` and `unset` take one |
| `--state <path>` | the protected variables' state, relative to the root; default `.configure-env/state.json` |
| `--no-color` | plain output |

## Commands

| Command | Writes | Agent use |
| --- | --- | --- |
| `apply` | yes | writes every schema file by its policy. `--set KEY=VALUE` (non-secrets only), `--generate KEY`, `--defer KEY`. Values come from `--set`, then `--generate`, then a non-empty env var of the same name, then the default. A missing required value writes nothing and exits 1, unless the key is deferred: then it is written empty and listed in `deferred`. |
| `check` | no | drift: missing files, generated files that differ, keys a merge file lacks, mode, invalid values. Exits 1 on any. |
| `validate` | no | the current values against the rules. `--strict` makes unknown keys errors. |
| `list` | no | every file's keys: set, valid, value (secrets masked). |
| `init` | yes | writes `env.schema.json`, inferred from `--from <file>` or `.env.example`. Refuses to overwrite without `--force`. Adds `.configure-env/` to `.gitignore`. |
| `set` | yes | `KEY=VALUE…`, `--generate KEY`, `--stdin KEY`, `--prompt KEY` (human only). `--create` creates a missing file. `--allow-unknown`, `--allow-template`. One invalid value writes nothing. |
| `get` | no | prints one value. A secret exits 1 unless `--reveal`; agents never pass `--reveal`. With `--json`, a secret is masked. |
| `unset` | yes | removes keys and the schema comment above them; an absent key is `absent`, exit 0. |

`set`, `get` and `unset` target the `--file` path, else the only non-template schema file. With several such files, `--file` is required (exit 2).

## Secrets

- `--generate KEY`: a random 48-character base64url value, adjusted to `minLength`/`maxLength`; a `maxLength` under 16 exits 2 (use `--prompt` or `--stdin`). With `encoding`, it is `bytes` random bytes (default 32) in that encoding; `bytes` under 16 exits 2. Only for `type: "string"` variables with `secret: true`. It never replaces a value that is already set; a set value that breaks the rules exits 1 (unset it to generate a new one). `apply` refuses it for a key that a `generate`-policy file writes, because that file would rotate the key on every run. In `apply`, a value a non-template file of the run already holds is reused, so every file gets the same secret; files holding different values exit 2, naming the files only.
- `--defer KEY` (apply only): a required key with no value is written empty instead of failing the run, for a human to set with `set --prompt KEY`. A key that is neither `required: true` nor `requiredUnless`, also given with `--set`/`--generate`, or undeclared, exits 2.
- Rules between variables (`requiredUnless`, `conflictsWith`, `distinctFrom`): `apply` and `set` write nothing that breaks one (exit 1), `--generate` (`apply` or `set`) of a key whose `conflictsWith` partner the same file would hold exits 2, before any value is made, and `validate`/`check`/`list` report them by key, never by value.
- `--stdin KEY` (set only): reads the value from piped stdin and strips one trailing newline; the output always masks it. It refuses a terminal. An empty value (a failed command in the pipe, `/dev/null`) exits 1 and writes nothing; so does input past 64 KiB. 60 s with no new input exits 2, and so does a pipe that sends the value but never closes: the wait restarts with each chunk.
- `--generate` and `--stdin` never write to a template, even with `--allow-template` (exit 2).
- Protected variables (`protected: true` or `{ "reason" }`): once a non-template file holds a non-empty value, `set` with another value, `unset`, and an `apply` that would change it exit 2 and write nothing; the same value is `unchanged`. A missing or empty key whose earlier value the state recorded takes only that value back (restore from a backup) or an empty one; anything else, such as `apply --generate` after `.env` was deleted, exits 2: `KEY was set on DATE; restore it from your backup, or pass --replace-protected KEY`. `--replace-protected KEY` (set, unset, apply; per key) allows the change: a person types the key in a terminal, `--ci`/`--json` need only the flag; the output says `replaced protected KEY`. The state (`.configure-env/state.json`, mode 600, git-ignored) holds salted HMACs only; `check`/`validate` report `KEY no longer matches the value recorded on DATE` (exit 1) and never write it. It knows only this machine's history: a fresh clone has none, and `git clean -fdx` deletes it.
- Output masks secrets as `••••` plus the last 2 characters once the value is longer than 8.

## JSON output

- `apply`: `{ command, ok, errors, files: [{ path, policy, action, status, addedKeys, written }], deferred: [key] }`; `deferred` lists keys written empty, only in files that were written; `[]` when nothing was written. A failure about a key (misused `--generate`/`--defer`, a value that cannot be generated) prints this document too, `files: []`, exit 1 or 2; errors carry `kind`, `key` (or `path`), `message`, never a value. `kind` is `value` (a value breaks its rules, exit 1), `file` (an unsafe path, exit 1), `usage` (the options misuse a key, exit 2) or `protected` (a change to a protected value, with `reason`, exit 2). `replaced: [{ file, key }]` appears when `--replace-protected` replaced a value.
- `check`: `{ command, ok, drift, errors, files: [{ path, policy, status, drift, missingKeys, invalid, invalidLines, protected, mode? }] }`; `protected` lists `{ kind, key, message, reason? }` per mismatched protected value
- `validate`: `{ command, ok, files: [{ path, template, exists, ok, errors, warnings }] }`; a protected mismatch is an error with `kind: "protected"`
- `list`: `[{ file, key, set, valid, error?, value | masked, description?, unknown? }]`
- `set`: `{ command, ok, file, keys: [{ key, status, value | masked, replaced? }] }`; `unset` is the same with `{ key, status, replaced? }`
- `init`: `{ command, ok, schema, from, variables, gitignore }`; `gitignore` is `created`, `added` or `present`
- `get`: `{ key, set, value | masked }`

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | drift, an invalid value or schema, or a failed write |
| 2 | usage: a bad option, no schema (run `init`), no terminal without `--ci`, a change to a protected value |
| 130 | cancelled |
