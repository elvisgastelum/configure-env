---
'@elvisgastelum/configure-env': minor
---

Schema v1 describes byte-length secrets and rules between variables.

- String variables take `encoding` (`base64`, `base64url` or `hex`) and `bytes`: the value must be canonical in that encoding and decode to exactly that many bytes. `--generate` on such a secret writes `bytes` random bytes (32 by default, at least 16) in the encoding, like `openssl rand -base64 32`.
- `requiredUnless` makes a variable required unless one of the named variables is set, and `conflictsWith` refuses two variables set together, for either-or pairs such as a key and a key file. `--defer` accepts a `requiredUnless` variable, and `--generate` refuses a key whose conflicting partner has a value.
- `distinctFrom` requires two set variables to hold different values, such as a previous key and the current one.
- `validate`, `check` and `list` report broken rules per file, naming the keys and never a value; `apply` and `set` write nothing that would break one. Generated files note `required unless X is set` in the comment of a `requiredUnless` variable.
