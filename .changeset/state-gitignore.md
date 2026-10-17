---
'@elvisgastelum/configure-env': minor
---

The state's directory (`.configure-env/`) gets a `.gitignore` of its own, written by the first run that writes the state: it names `state.db`, its SQLite side files (`-journal`, `-wal`, `-shm`) and `state.json`, so the state stays out of git even when the root's `.gitignore` does not ignore the directory. It is written only into a directory the run created or one named `.configure-env`, never over an existing `.gitignore`.

`check` reports what git could commit that it must not, each an error in a new `gitignore` list of the report: `state-not-ignored` (the state folder's own `.gitignore` is missing or lacks a state file) and `file-not-ignored` (in a git work tree, an env file holding real values that the repository does not ignore). A project that passed `check` before can now fail it until these are fixed.
