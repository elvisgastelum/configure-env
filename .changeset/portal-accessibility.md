---
'@elvisgastelum/configure-env': patch
---

The portal passes axe on every page and dialog, in the light and dark themes, and keeps its results on screen.

- The variables grid's group rows hold only cells; the files page's headings follow the page's order; diffs that scroll take the keyboard focus; a revealed secret in a selected row meets 4.5:1 contrast; the schema page's tab panels show the focus ring.
- Menus open inside the page's main landmark, or inside the dialog or drawer that opened them.
- The apply plan's long lines scroll inside their own box instead of widening the dialog past the screen.
- Applying one file from Check keeps its result until Done, and saving a value from Check or Validate keeps its "Saved" toast with Undo, though the fixed item leaves the report.
- A tab without the session gets a page saying to open the launch link again, not the API's JSON error.
- When the portal inits a schema, it never writes `.gitignore` through a symlink, and `serve` takes only a missing schema file for "no schema yet".
