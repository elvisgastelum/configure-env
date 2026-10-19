---
'@elvisgastelum/configure-env': patch
---

`apply --json` prints its document when the API refuses the run: a 409 from the apply (a file changed since the plan, or its generated values are gone) or a 503 from the plan (a protected state it cannot read). The error is `{"kind": "request", "status", "message"}` with the API's message; the exit code and the text output are unchanged.
