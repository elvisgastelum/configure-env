---
'@elvisgastelum/configure-env': minor
---

`apply` fixes mode drift: an existing file whose content needs no change but whose mode differs from the schema's `mode` gets a chmod only.

- It covers every policy, an existing create-only `.env` included, and needs no value. The content is never read for values or rewritten.
- Text status `mode fixed (644 → 600)`; with `--json`, action `mode` and `mode: { "from", "to" }`. A file that is also rewritten carries `mode` when its mode changed.
- It only removes permissions: a schema mode that would add one is refused for that file, `mode not loosened (400, schema says 600)`, with a `file` error and exit 1.
- The file is opened without following a symlink and changed with `fchmod`, so the umask does not apply. A chmod never takes the protected variables' lock or writes the state.
- `check` adds the hint `run configure-env apply to fix it` to its mode line, in text output only.
