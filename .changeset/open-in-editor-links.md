---
'@elvisgastelum/configure-env': minor
---

The portal opens variables, env file entries and schema errors in your editor at the right line.

- Every variable (the table row and the drawer), env file entry, check and validate item, and schema error has an **Open in editor** button; its tooltip shows the shortcut `o`, which opens the focused or selected item. A toast explains how to set an editor when none was found.
- The API adds `POST /api/open-in-editor`, which starts your editor with launch-editor: `$LAUNCH_EDITOR`, then `$VISUAL`, then `$EDITOR`, else a running VS Code, Cursor, Zed or JetBrains IDE. It opens only the schema file or one of its env files inside the root, never through a symlink, and answers only requests from this machine, with the session token. The line comes from the dotenv parser for a variable's entry, and from a JSON source map of the schema for a JSON path such as `files[1].variables[0]`.
