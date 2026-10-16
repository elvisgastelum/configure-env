# @configure-env/web

The configure-env portal: a static single-page app the local API serves behind its token. The repository README describes the shell, the overview, the variables browser and the session; this file describes the schema editor.

## Schema editor (`/schema`)

The schema page adds, changes, reorders and removes the variables and files of `env.schema.json`. Nothing is written until you have seen the diff, and an invalid schema is never written: the browser checks the edit with the core's own code, and the API checks it again before it writes.

### Quick path

1. Open **Schema**, then **Add variable**, or the pencil on a variable.
2. Fill the form and choose **Review changes**. A field the schema refuses shows its error, and the review does not open.
3. In the review, read the side-by-side diff (or the **Raw JSON** tab), then choose **Save**.

### What you can edit

| Area | Fields |
| --- | --- |
| Every variable | name (a rename lists the references it rewrites), type, description, group (pick one or type a new one), comment, required, secret, empty value (`allowEmpty`), protected (`true` or with a reason, only for a secret), default and example (a select for a boolean or an enum, a number field for a number, an integer or a port) |
| Rules | `requiredUnless`, `conflictsWith` and `distinctFrom`, each a picker over the other variables |
| string | `minLength`, `maxLength`, `pattern` with a live tester, `patternMessage`, `encoding`, `bytes` |
| number, integer | `min`, `max` |
| enum | `values`, a list to add to, reorder and remove from |
| url | `protocols` |
| ipv4, ipv6, ip | `within`, a pick of the cidr variables |
| cidr | `within`, `family`, `strict` |
| boolean, email, host, port | no other options |
| A new variable | the files with their own variable list it joins |
| Every file | path, policy (each one explained), mode, template, every variable (`*`) or an ordered pick (drag, or the arrows), header, description, and the per-file `values` and `comments` |

Switching a variable's type clears the options the new type does not take, and a default or example that is not a value of the new type. The form asks first and lists what it would clear.

### Removing and reordering

- **Remove a variable:** the dialog lists every place that names it (rules of other variables, file lists, per-file values and comments). Those references are removed with it (`cleanup`), so nothing is left dangling.
- **Remove a file:** the dialog lists the variables no other file holds. They stay declared, in no file; the env file stays on disk.
- **Reorder:** drag a variable, or use its arrows, then choose **Review order**. Files that take `*` write the variables in this order.

## How an edit is checked and saved

| Step | Where | What happens |
| --- | --- | --- |
| Validate | browser | The form's zod schema turns the form into an edit, applies it with the core's schema writer (`@configure-env/core/schema`), and puts each JSON-path error the writer reports on the field it names. |
| Review | browser | The diff compares the schema now with the document the edit makes, both formatted by the core's `formatJson`. |
| Save | API | The edit goes to the schema write endpoints (`/api/schema/...`) with the fingerprint of the schema shown. A change and a rename are two writes, the second against the fingerprint the first returns. |
| Stale (409) | browser | The schema changed since it was read. The review shows the edit on top of the schema as it is now, and asks you to save again. |
| Refused (422) | browser | The API's errors carry JSON paths. The review closes, and each error goes back on its form field; one with no field is listed above the form. |

`@configure-env/core/schema` is the browser-safe part of the core: the schema definitions and checks, the value checks, and the pure schema edits. The core's package index needs Node, so the portal imports only this entry. A core test keeps it free of Node built-ins.

## Tests and stories

- The form tests (`src/features/schema/*.test.tsx`) run against the msw handlers. The schema writes there run the core's schema writer, as the API does, so a handler refuses what the API refuses.
- The stories are under `Portal/Schema`: the editor, every type, an invalid schema, no schema, and loading. Run them with `pnpm storybook:web`.
