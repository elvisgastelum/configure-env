---
'@elvisgastelum/configure-env': minor
---

IP network types and the `within` rule, so a schema no longer needs a hand-written pattern for an address or a subnet.

- New variable types: `ipv6` (no zone), `ip` (IPv4 or IPv6) and `cidr` (`address/prefix`). `cidr` takes `family` (`ipv4`, `ipv6` or `any`, the default) and `strict`, which refuses host bits and suggests the network address (`host bits are set; use 172.30.250.0/24`), leaving it out for a `secret` variable.
- `within: "<CIDR VARIABLE>"` on `ipv4`, `ipv6`, `ip` and `cidr` variables: when both are set and valid, the address, or the whole block, must lie inside the named variable's network. It holds per file like the other rules: `validate`, `check` and `list` report `WEB_ADDRESS: must be within APP_SUBNET`, and `apply` and `set` refuse a file that breaks it. Messages name the keys, never a value.
- The loader checks `within` on the schema too: `default` and `example` against the target's `default`, and the values each template file writes.
