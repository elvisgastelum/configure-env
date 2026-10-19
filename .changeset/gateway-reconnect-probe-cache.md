---
'@elvisgastelum/configure-env': patch
---

The portal keeps its live updates from another environment through a brief outage, and listing the environments no longer waits on every server on every call.

- While an environment cannot be reached, `GET /env/<name>/api/events` answers 200 `text/event-stream` with `retry: 2000` and one `unreachable` event naming the environment, then closes, instead of a 502 that made `EventSource` stop reconnecting. A server that refuses its token still answers 502.
- The portal header says **Not answering; retrying…** (in English and Spanish) while that lasts, and clears it, refetching every view, once the server answers again.
- `GET /api/environments` keeps each environment's probe for 5 seconds; an entry of `environments.json` that changes, comes or goes is seen on the next call. Nothing kept holds a token.
