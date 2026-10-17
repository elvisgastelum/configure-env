---
'@elvisgastelum/configure-env': minor
---

`check` fixes the git-ignore problems it reports. In a terminal it asks which to fix, every one selected first; `check --fix` fixes them without asking, with `--ci` or `--json` too. A fix adds the missing lines to the state folder's `.gitignore`, or `/<path>` to the root's `.gitignore`, creating it when needed, and never writes through a symlink. The report it prints is the one after the fix, preceded by what it wrote; `--json` adds `fixed`, each `.gitignore` written with the lines it added.
