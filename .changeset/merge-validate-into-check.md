---
'@elvisgastelum/configure-env': minor
---

`check` is the one command that reports what is wrong with the env files: `validate` is merged into it, as one report by file. This breaks scripts that use `validate` or parse the old `check --json`.

- `validate` is removed, with no alias: run `check` instead, with the same `--strict` and `--file`. The portal's Validate page and `GET /api/validate` are removed too; the Check page and `GET /api/check` show the whole report.
- One report, by file in schema order: each problem has a `severity` (`error` or `warning`), a `code` (`missing-file`, `differs`, `missing-key`, `mode`, `refused`, `invalid-line`, `invalid-value`, `rule`, `protected`, `unknown-key`), a `message` that never holds a value, and a `fix` (`apply`, `prune` or `set`; absent when a person decides). A key reported missing is not also reported invalid.
- `check --json` prints `{ "command": "check", "ok", "summary": { "errors", "warnings", "files", "failing" }, "files", "errors" }`; each file has `path`, `policy`, `template`, `status`, `mode` (when it differs), `ok` and `problems`. The old `drift`, `missingKeys`, `unknownKeys`, `invalid`, `rules`, `invalidLines` and `protected` fields are gone. The exported types follow: `CheckReport`, `FileCheck` and `CheckProblem` replace `DriftReport`, `FileDrift` and `InvalidValue`.
- The text output is one line per problem, `path: <message>` (`warning:` marked), `path: ok` for a file without any, and a last line such as `3 errors, 1 warning in 2 files`.
- An unknown key is a warning, which exits 0; `--strict` makes it an error.
- A missing create-only file is now an error, as under every other policy. In CI, check the committed files with `--file`, such as `check --ci --file .env.example`.
- `check` exits 1 on any error: drift, an invalid value or line, a broken rule, or a protected value that no longer matches the state.
