---
'@elvisgastelum/configure-env': minor
---

Removing a variable leaves the env files clean.

- `unset` also removes the blank line that set the removed block apart, so a file the tool wrote is left as a fresh `apply` would write it: no doubled, leading or trailing blank line. Every other byte stays, line endings included.
- `apply --prune` removes the keys a merge file, or an existing create-only file, holds that the schema does not list for it, each with the `#` lines directly above it. A comment set apart by a blank line stays, and generate files are rewritten as before. Text status `pruned keys: A, B` (`added keys: C; pruned keys: A, B` with both); with `--json`, `prunedKeys` per file (`[]` without it). The terminal plan lists `prune keys: A, B`. A pruned key's protected fingerprint is removed under the state's lock. It is opt-in: without it, `apply` keeps every key.
- `check --strict` reports those keys as drift, `unknown keys: A, B (run configure-env apply --prune to remove them)`, with `unknownKeys` per file in JSON, and exits 1.
