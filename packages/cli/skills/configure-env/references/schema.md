# env.schema.json (v1)

Every object is strict: an unknown key is an error. Top level: `$schema`, `version: 1`, `variables`, `files`.

```json
{
  "$schema": "https://raw.githubusercontent.com/elvisgastelum/configure-env/main/schema/env.schema.v1.json",
  "version": 1,
  "variables": {
    "PORT": { "type": "port", "default": 3000, "description": "HTTP port" },
    "DATABASE_URL": { "type": "url", "protocols": ["postgres"], "required": true, "secret": true },
    "SESSION_SECRET": { "type": "string", "secret": true, "required": true, "minLength": 32 }
  },
  "files": [
    { "path": ".env.example", "policy": "merge", "variables": "*" },
    { "path": ".env", "policy": "create-only", "mode": "600", "variables": "*" }
  ]
}
```

## Variables

Fields: `type` (required), `description`, `group`, `required`, `allowEmpty`, `default`, `example`, `secret`, `comment`, `requiredUnless`, `conflictsWith`, `distinctFrom`, `within`, `protected`. `default` and `example` must pass the variable's own rules and use its JSON type (a number for `port`).

| Type | Options |
| --- | --- |
| `string` | `minLength`, `maxLength`, `pattern`, `patternMessage`, `encoding` (`base64` padded, `base64url` unpadded, `hex`), `bytes` (decoded length; needs `encoding`) |
| `number`, `integer` | `min`, `max` |
| `boolean` | none; written as `true`/`false` |
| `enum` | `values` (required) |
| `email`, `host`, `port` | none |
| `ipv4`, `ipv6`, `ip` (either family) | `within` |
| `cidr` (`address/prefix`) | `family` (`ipv4`, `ipv6`, `any`; default `any`), `strict` (default `false`), `within` |
| `url` | `protocols` |

A value with `encoding` must be canonical: what `Buffer#toString` writes, so base64 keeps its `=` padding and base64url has none. `--generate` on such a secret writes `bytes` random bytes (default 32) in that encoding.

IPv4 takes four decimal octets, no leading zeros; IPv6 takes no zone (`%eth0`). A `cidr` prefix is decimal, no leading zero, at most 32 (IPv4) or 128 (IPv6). `strict: true` refuses host bits (`10.0.0.1/8`): `host bits are set; use 10.0.0.0/8`, the network address left out for a `secret` variable. `family` and `strict` belong to `cidr` only.

## Rules between variables

Each takes a declared name or a non-empty list, never the variable itself. A value is set when it is not empty.

- `requiredUnless`: required unless one of the named is set; not with `required: true`. `--defer` accepts it.
- `conflictsWith`: it and a named one must not both be set (symmetric). `--generate` of it exits 2 while a file it writes would hold the other.
- `distinctFrom`: when both are set, the values must differ.
- `within` (on `ipv4`, `ipv6`, `ip`, `cidr`; one name): the named variable is a `cidr`, and when both are set and valid the address, or the whole block, lies inside its network; another family fails. Errors: `WEB_ADDRESS: must be within APP_SUBNET`. The loader also checks `default` and `example` against the target's `default`, and each template's `values` (with the defaults) against each other.

They hold per file, over the file's own keys; a name the file does not list is ignored there. Templates are not checked. `check` and `list` report them, naming keys only; `apply` and `set` refuse to write a file that breaks one (exit 1); `unset` may leave a `requiredUnless` unsatisfied for `check` to report.

A master key given directly or as a file, never both, and a previous key that must differ:

```json
"SM_MASTER_KEY": { "type": "string", "secret": true, "encoding": "base64", "bytes": 32, "requiredUnless": "SM_MASTER_KEY_FILE", "conflictsWith": "SM_MASTER_KEY_FILE" },
"SM_MASTER_KEY_FILE": { "type": "string" },
"SM_PREVIOUS_MASTER_KEY": { "type": "string", "secret": true, "encoding": "base64", "bytes": 32, "conflictsWith": "SM_PREVIOUS_MASTER_KEY_FILE", "distinctFrom": "SM_MASTER_KEY" },
"SM_PREVIOUS_MASTER_KEY_FILE": { "type": "string" }
```

`apply --ci --generate SM_MASTER_KEY` writes what `openssl rand -base64 32` would.

An address that must sit in the app's subnet:

`"APP_SUBNET": {"type": "cidr", "family": "ipv4", "default": "172.30.250.0/24"}, "WEB_ADDRESS": {"type": "ipv4", "default": "172.30.250.10", "within": "APP_SUBNET"}`

## Protected variables

`"protected": true` or `"protected": { "reason": "it encrypts the vault" }` marks a value that must never change once a file holds it: a master key, a password baked into a volume. It needs `secret: true` (a schema error otherwise) and has no effect on templates. `set`, `unset` and `apply` refuse to change or remove it (exit 2) without `--replace-protected KEY`, and a value recorded in `.configure-env/state.db` cannot be replaced by a new one after the file lost it. Generated entries get the comment line `protected: <reason>` (or `protected`). See `commands.md`.

```json
"SM_MASTER_KEY": { "type": "string", "secret": true, "encoding": "base64", "bytes": 32, "protected": { "reason": "it encrypts the vault" } }
```

## Files

Fields: `path` (relative, `/`-separated, no `..`), `policy`, `variables` (`"*"` or a list), `mode` (three octal digits, `"600"`), `header`, `template`, `values` (literal per-file placeholders), `comments`, `description`.

`mode` is the file's permissions, under any policy and on a template too. A new or rewritten file gets it; an existing one whose content is current gets a chmod from `apply` when the mode only removes permissions (`mode fixed (644 → 600)`), and is refused when it would add one (`mode not loosened`, exit 1). Without `mode`, a file keeps its own, and a new one gets `644`.

| Policy | Behavior |
| --- | --- |
| `generate` | owns the file; rewrites it whenever it differs |
| `merge` | appends missing keys, never changes existing lines |
| `create-only` | writes it only when it does not exist |

A file is a template when `template: true`, or when its path ends in `.example`, `.sample` or `.template`. A template takes only its `values` entries and defaults, never a given, generated, env or prompted value, so it cannot leak a secret. Commit templates. Keep real env files out of git.

Use `merge` for `.env.example` and `create-only` with `mode: "600"` for `.env`. Do not put a secret in a `generate`-policy real file: it would be rewritten on every run.
