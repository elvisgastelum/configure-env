---
'@elvisgastelum/configure-env': minor
---

The local `serve` is a gateway to the environments `env add` stored.

- `GET /api/environments` lists `local`, then each environment of `.configure-env/environments.json` with its URL, whether it answers and its version; never a token.
- `/env/<name>/api/*` is forwarded to that environment's server with its bearer token, behind the local server's own token, Host and Origin checks. Only the stored environments and their `/api/` paths are reached; the browser's cookie, `Origin`, `Referer` and `Sec-Fetch-*` headers, the local bearer and the hop-by-hop headers never leave, and the other server's cookies and CORS headers never come back. `GET /env/<name>/api/events` streams through. An unknown name answers 404; a server that cannot be reached, or that refuses its token, answers 502 naming the environment. Open in editor is never forwarded.
