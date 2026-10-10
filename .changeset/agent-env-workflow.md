---
'@elvisgastelum/configure-env': minor
---

Agents can configure env files without handling secrets.

- `set --generate KEY` and `apply --generate KEY` write a random value for a secret string variable. The value is never printed, and an existing value is never replaced. A `maxLength` under 16 is refused, since a secret that short is too weak to generate.
- `set --stdin KEY` reads one value from piped stdin, so a secret manager can pass it in without it reaching argv. An empty pipe writes nothing. The wait is an idle timeout of 60 seconds that restarts with each chunk, so a stdin that stops sending, including a pipe that never closes, exits 2.
- `apply --defer KEY` writes a required variable empty when it has no value, instead of failing the run, and reports it, so a person can set it later.
- The package ships an agent skill in `skills/configure-env/`.
