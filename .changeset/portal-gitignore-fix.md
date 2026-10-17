---
'@elvisgastelum/configure-env': minor
---

The portal's check page lists the git-ignore problems in a **What git could commit** section, each with the lines its fix adds, and fixes one (**Fix**) or all (**Fix all**) through the new `POST /api/check/gitignore`, as `check --fix` does. `GET /api/check` reports them in `gitignore`. A `.gitignore` that is a symlink is named, never written.
