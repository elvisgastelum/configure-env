---
'@elvisgastelum/configure-env': patch
---

An `apply --generate` whose plan's generated values the server no longer holds says why instead of always saying they expired: `the generated values for this plan expired; run apply again` only after 15 minutes, `the generated values for this plan were dropped to make room for 64 newer plans; run apply again` when newer plans pushed them out, and `this server does not hold the generated values for this plan: it restarted since the plan, or another instance made it; run apply again` otherwise. It still exits 1 (409 from `POST /api/apply`) and writes nothing. The server logs a dropped plan on stderr by its fingerprint, never its value, and the values are held per `serve` instance, so a plan and its apply must reach the same one.
