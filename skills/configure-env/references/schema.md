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

Fields: `type` (required), `description`, `group`, `required`, `allowEmpty`, `default`, `example`, `secret`, `comment`. `default` and `example` must pass the variable's own rules and use its JSON type (a number for `port`).

| Type | Options |
| --- | --- |
| `string` | `minLength`, `maxLength`, `pattern`, `patternMessage`, `encoding` (`base64` padded, `base64url` unpadded, `hex`), `bytes` (decoded length; needs `encoding`) |
| `number`, `integer` | `min`, `max` |
| `boolean` | none; written as `true`/`false` |
| `enum` | `values` (required) |
| `email`, `host`, `ipv4`, `port` | none |
| `url` | `protocols` |

## Files

Fields: `path` (relative, `/`-separated, no `..`), `policy`, `variables` (`"*"` or a list), `mode` (`"600"`), `header`, `template`, `values` (literal per-file placeholders), `comments`, `description`.

| Policy | Behavior |
| --- | --- |
| `generate` | owns the file; rewrites it whenever it differs |
| `merge` | appends missing keys, never changes existing lines |
| `create-only` | writes it only when it does not exist |

A file is a template when `template: true`, or when its path ends in `.example`, `.sample` or `.template`. A template takes only its `values` entries and defaults, never a given, generated, env or prompted value, so it cannot leak a secret. Commit templates. Keep real env files out of git.

Use `merge` for `.env.example` and `create-only` with `mode: "600"` for `.env`. Do not put a secret in a `generate`-policy real file: it would be rewritten on every run.
