---
'@elvisgastelum/configure-env': minor
---

Every change to the env files or the schema is recorded, and the portal can undo one safely.

- `set`, `unset`, `apply` and `init` record what they changed in the history of edits in `.configure-env/state.db`, as the portal's writes do. A write now creates the database even when nothing is protected. A history that cannot be written is a `warning:` line on stderr (`warnings` in `apply --json`), never a failure.
- A change to a variable that is not secret keeps its values in plain text, and a schema write keeps the schema's text, so it can be undone. A secret's value is never stored: its change records fingerprints and a masked preview only, and says it can't be undone. A migration adds the columns; changes recorded before it can't be undone.
- `configure-env history [--json]` lists the 20 latest changes, newest first, with masked previews.
- The portal has a History page: a timeline with a diff per entry (secrets masked), filters by file, variable, actor and date, and an undo with a confirmation. The toast after each value or schema edit has an Undo action, and the variable drawer has a History tab.
- The API adds `GET /api/history` (filtered and paged) and `POST /api/history/{id}/undo`, which writes the previous state only while the file still holds what the change wrote (409 with an explanation otherwise). Value writes answer with the ids of the changes they recorded (`changes`), schema writes with theirs (`change`).
