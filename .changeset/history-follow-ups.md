---
'@elvisgastelum/configure-env': patch
---

The history of edits handles changes an older version recorded.

- A secret's change recorded before the history kept values says it can't be undone because the value is secret and never stored, as a newer one does, and the API marks it `secret`.
- `configure-env history` and `GET /api/history` change nothing again: they read the state database without upgrading it, so a database an older version wrote stays readable by that version. Its changes are listed as recorded before values were kept. A write or an undo still upgrades it first.
