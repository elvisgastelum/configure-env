---
'@elvisgastelum/configure-env': minor
---

Protected variables: values that must never be replaced silently, such as an encryption master key.

- A variable takes `protected: true` or `protected: { "reason": "..." }`; it needs `secret: true`.
- Once a non-template file holds a protected value, `set` with another value, `unset`, and an `apply` that would change it exit 2 and write nothing, with the error kind `protected`. The same value is `unchanged`.
- `.configure-env/state.json` (or `--state <path>`) records a salted HMAC of each protected value, never the value, with mode 600. A deleted `.env` recreated with a new `--generate` value exits 2: `KEY was set on DATE; restore it from your backup, or pass --replace-protected KEY`. The recorded value itself is taken back.
- `--replace-protected KEY` on `set`, `unset` and `apply` allows the change, after the person types the key's name in a terminal; with `--ci` or `--json` the flag is enough.
- `check` and `validate` report `KEY no longer matches the value recorded on DATE` and never write the state.
- `init` adds `.configure-env/` to `.gitignore`.
- The state knows only this machine's history: a fresh clone has none, and `git clean -fdx` deletes it.
