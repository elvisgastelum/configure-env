---
'@elvisgastelum/configure-env': minor
---

`configure-env install skill` installs the agent skill the package ships, replacing the manual `cp -R` from `node_modules`.

- `--scope project` (the git top level of the root, else the root), `local` (the same folder, with its path added once to `.git/info/exclude`; exits 2 outside a git repository) or `user` (under the home folder).
- `--mode copy` copies the folder; `--mode symlink` links to the package's folder (a junction on Windows).
- `--agent claude` (`.claude/skills/configure-env`, the default) or `agents` (`.agents/skills/configure-env`); repeat it for both.
- In a terminal it asks for the missing choices; with `--ci`, `--json` or no terminal they default to project, copy and claude.
- An existing skill exits 2 unless `--force`, except a symlink to the same folder, reported `unchanged`. `--force` builds the new skill next to the old one and swaps it in, so a failure keeps the old one, and removes a link without following it.
- A run that fails part-way exits 1 and still reports the skills it installed (with `--json`, `ok: false`, those `skills` and a `file` error). `--scope local` trusts a `.git` file only when its git dir names it back.
- Text output `installed  .claude/skills/configure-env (copy)`, `linked` or `unchanged`; with `--json`, `{ "command": "install", "ok", "source", "skills" }`.
- The agent skill documents `install skill` and asks before `--scope user` or `--force`; its command reference adds the `install` JSON, the `set`/`unset` state-failure JSON and the `install` exit codes.
