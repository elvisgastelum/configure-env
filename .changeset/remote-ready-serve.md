---
'@elvisgastelum/configure-env': minor
---

`configure-env serve` can run headless on a dev, stage or prod machine and be reached from another one, directly over HTTPS or behind a reverse proxy such as Caddy.

- `--token-file <path>` and `CONFIGURE_ENV_TOKEN` give a token that survives restarts, at least 32 characters. A missing token file is created with a random token, mode 600. The token is never printed: the output names where it is. Without either, every run still makes a fresh token.
- `--public-url <url>` names the address clients use. The server answers its host and origin as well as the bound address, still refuses every other host, and reports the public URL. Over an https public URL the session cookie is `Secure`.
- `--tls-cert <path>` and `--tls-key <path>` serve HTTPS; the URL becomes `https://…`. A non-loopback `--host` no longer needs `--unsafe-expose` when TLS is on; over plain HTTP it still does, with the same warning.
- Open in editor refuses a request through a proxy (a forwarding header, or the public URL's Host), even from a loopback socket.
