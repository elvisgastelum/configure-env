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
| `--no-color` | plain output |

## Commands

| Command | Writes | Agent use |
| --- | --- | --- |
| `apply` | yes | writes every schema file by its policy. `--set KEY=VALUE` (non-secrets only), `--generate KEY`. Values come from `--set`, then `--generate`, then a non-empty env var of the same name, then the default. A missing required value writes nothing and exits 1. |
| `check` | no | drift: missing files, generated files that differ, keys a merge file lacks, mode, invalid values. Exits 1 on any. |
| `validate` | no | the current values against the rules. `--strict` makes unknown keys errors. |
| `list` | no | every file's keys: set, valid, value (secrets masked). |
| `init` | yes | writes `env.schema.json`, inferred from `--from <file>` or `.env.example`. Refuses to overwrite without `--force`. |
| `set` | yes | `KEY=VALUE…`, `--generate KEY`, `--stdin KEY`, `--prompt KEY` (human only). `--create` creates a missing file. `--allow-unknown`, `--allow-template`. One invalid value writes nothing. |
| `get` | no | prints one value. A secret exits 1 unless `--reveal`; agents never pass `--reveal`. With `--json`, a secret is masked. |
| `unset` | yes | removes keys and the schema comment above them; an absent key is `absent`, exit 0. |

`set`, `get` and `unset` target the `--file` path, else the only non-template schema file. With several such files, `--file` is required (exit 2).

## Secrets

- `--generate KEY`: a random 48-character base64url value, adjusted to `minLength`/`maxLength`. Only for `type: "string"` variables with `secret: true`. It never replaces a value that is already set. `apply` refuses it for a key that a `generate`-policy file writes, because that file would rotate the key on every run.
- `--stdin KEY` (set only): reads the value from piped stdin and strips one trailing newline. It refuses a terminal.
- Output masks secrets as `••••` plus the last 2 characters once the value is longer than 8.

## JSON output

- `apply`: `{ command, ok, errors, files: [{ path, policy, action, status, addedKeys, written }] }`
- `check`: `{ command, ok, drift, errors, files: [{ path, policy, status, drift, missingKeys, invalid, invalidLines, mode? }] }`
- `validate`: `{ command, ok, files: [{ path, template, exists, ok, errors, warnings }] }`
- `list`: `[{ file, key, set, valid, error?, value | masked, description?, unknown? }]`
- `set`: `{ command, ok, file, keys: [{ key, status, value | masked }] }`; `unset` is the same with `{ key, status }`
- `get`: `{ key, set, value | masked }`

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | drift, an invalid value or schema, or a failed write |
| 2 | usage: a bad option, no schema (run `init`), no terminal without `--ci` |
| 130 | cancelled |
