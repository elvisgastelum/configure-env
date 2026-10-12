---
'@elvisgastelum/configure-env': minor
---

The protected variables' state moves from `.configure-env/state.json` to a SQLite database, `.configure-env/state.db` (better-sqlite3, with drizzle-kit migrations shipped in the package and applied when it opens).

- The first run that writes the state imports an existing `state.json`, checks every fingerprint arrived, and removes it; until then it is read as it is. An interrupted import is finished by the next run.
- Concurrent runs no longer use the `state.json.lock` file: a run holds a SQLite write transaction, waits 2 seconds for another run's, then exits 1 with `in use by another run; try again`. A crashed run leaves nothing to remove by hand.
- The database also holds a `changes` table for the history of edits (fingerprints and masked previews only, never values).
- `--state` defaults to `.configure-env/state.db`. The API's `loadState`, `writeState` and `updateState` keep their signatures and use the database.
