---
'@elvisgastelum/configure-env': minor
---

`configure-env serve --advertise` announces the server on the local network over mDNS, as a `_configure-env._tcp` service on its port, so other machines on the LAN find it without knowing its address.

- Its TXT record holds `v` (the version), `name` (`--name <name>`, else the hostname), `tls` (`1` or `0`) and, over HTTPS, `fp` (the certificate's SHA-256 fingerprint). Never the token, the project's root, or a file or variable name.
- `--advertise` with a loopback host exits 2: nothing on the LAN can reach a loopback server. A non-loopback host still needs TLS or `--unsafe-expose`, and advertising without TLS warns.
- The service is unpublished when `serve` stops. It uses `bonjour-service`, pure JavaScript: nothing to build natively.
