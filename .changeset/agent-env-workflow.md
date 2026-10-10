---
'@elvisgastelum/configure-env': minor
---

Agents can configure env files without handling secrets.

- `set --generate KEY` and `apply --generate KEY` write a random value for a secret string variable. The value is never printed, and an existing value is never replaced.
- `set --stdin KEY` reads one value from piped stdin, so a secret manager can pass it in without it reaching argv. An empty pipe writes nothing, and a stdin that never sends anything gives up after 60 seconds.
- `apply --defer KEY` writes a required variable empty when it has no value, instead of failing the run, and reports it, so a person can set it later.
- The package ships an agent skill in `skills/configure-env/`.
