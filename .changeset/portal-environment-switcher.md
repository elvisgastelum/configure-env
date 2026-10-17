---
'@elvisgastelum/configure-env': minor
---

The portal switches between local and the environments `env add` stored, such as dev, stage and prod, through the local `serve`.

- The header has an environment picker (in English and Spanish): `local`, then each environment with its URL, an unreachable one disabled. The active one is always shown, and `prod` stands apart in red with a Production tag. Picking one refetches every view, the live updates included, from that environment; Open in editor is hidden for it. The browser stays same-origin with its session cookie and never holds the other server's token.

- `GET /api/environments` lists `local`, then each environment of `.configure-env/environments.json` with its URL, whether it answers and its version; never a token.
- `/env/<name>/api/*` is forwarded to that environment's server with its bearer token, behind the local server's own token, Host and Origin checks. Only the stored environments and their `/api/` paths are reached; the browser's cookie, `Origin`, `Referer` and `Sec-Fetch-*` headers, the local bearer and the hop-by-hop headers never leave, and the other server's cookies and CORS headers never come back. `GET /env/<name>/api/events` streams through. An unknown name answers 404; a server that cannot be reached, or that refuses its token, answers 502 naming the environment. Open in editor is never forwarded.
