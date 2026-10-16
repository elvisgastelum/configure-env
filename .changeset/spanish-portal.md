---
'@elvisgastelum/configure-env': minor
---

The portal speaks Spanish as well as English.

- `configure-env serve` opens the portal in the browser's language when it is Spanish, else English. A switcher in the header (and the ⌘K palette) changes it; the pick is kept on this device, and `<html lang>` follows it.
- Plurals follow each language, and the history shows relative dates ("hace 5 minutos") with the full date on hover.
- The schema's own text (descriptions, comments, headers) and the engine's and API's messages are shown as written.
- An env file card in the overview and the files page keeps its file name visible on a narrow card: its Open and Details buttons move below the name when there is no room beside it.
