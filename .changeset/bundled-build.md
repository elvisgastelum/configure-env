---
'@elvisgastelum/configure-env': patch
---

The package is built as a bundle: `dist/cli.js` and `dist/index.js` with their declarations, in place of one file per source module. The CLI, the programmatic API and its types are unchanged; only deep imports into `dist/`, which `exports` never allowed, no longer resolve.
