# @configure-env/web

The configure-env portal: a static single-page app the local API serves behind its token. The repository README describes the shell, the overview, the variables browser and the session; this file describes the env files workspace, apply, check, validate, live updates and the schema editor.

## Env files (`/files`)

A card per schema file shows its policy, mode (and the schema's, when they differ), the template flag, whether the file exists, its drift and how many lines do not parse. **Details** opens the missing and unknown keys in place; **Open** shows the file's detail in place of the cards (`/files?focus=<path>`, where the palette's file jump lands):

- **Entries:** the variables the file lists, in schema order, with their status and value. The pencil edits a value in place and the menu generates or unsets it, with the same editor, secret masking and reveal, and conflict dialog as the variables page.
- **Raw:** the file as it is on disk, read-only, from `POST /api/files/content` (secret values masked by the API): numbered lines with comments, `export`, keys and values highlighted, and the lines that do not parse marked.

## Apply

**Apply** (on the files page, and **Apply every file** or **Apply <file>** on the check page) does what `configure-env apply` does:

1. **Values.** One prompt per value the run needs, by group, as the TUI asks them: every key of a file it creates or regenerates, and the keys a merge file gains, except in a template or where the file sets the value literally. Each starts at its default. A secret string has **Generate**: a random value made in the browser with the core generator's lengths and encodings and checked with the core's `validateValue` (plan and apply take values, not keys to generate). An optional value left empty takes its default.
2. **Preview.** `POST /api/plan` with those values. Each file shows its action (**Create**, **Update**, **Mode only**, **Unchanged**, **Skip** with the reason), the keys it adds or removes, the mode change, and a unified diff of the API's lines (secrets masked by the API; long unchanged stretches folded, as in the schema review). Value errors and protected values stop it; **Replace the protected values** plans again with `replaceProtected`.
3. **Confirm.** **Apply…** names the files it will write; **Write** sends `POST /api/apply` with the plan's fingerprint.
4. **Result.** Each file with what was done, appearing one after another (all at once under reduced motion), and the count written, announced to screen readers. A plan that changed since it was shown (409) or that the API refuses (422) brings back the plan as it is now; nothing was written.

The values are kept only in the dialog: the plan and apply requests are mutations with no cache, so a secret typed or generated there is gone when the dialog closes.

## Check (`/check`) and validate (`/validate`)

| Page     | Grouped by                  | Items                                                                                                                                                                        | Fix                                                                                                                      |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Check    | file, with its drift status | the file is missing or differs, missing keys, invalid values (shown masked), rule and protected problems, unknown keys, the mode, lines that do not parse; plan errors above | **Set KEY in FILE** edits the value in place; **Apply FILE** opens apply for that file; a bad line links to the raw view |
| Validate | file, then variable         | value, rule and protected errors per variable (a rule under the first key it names, the others linked), lines that do not parse, warnings                                    | **Fix KEY in FILE** edits the value in place                                                                             |

Every variable name links to the variables page (`/variables?focus=KEY`). **Run check** and **Run validate** ask the API again; any write in the portal refreshes both.

## Live updates

While the portal is open it listens on `GET /api/events`. A `changed` event (the API watches the schema and every env file it lists) makes every view fetch again, and a toast names the paths that changed outside the portal. The portal's own writes change the files too: an event within two seconds of one of its writes refreshes quietly.

## Schema editor (`/schema`)

The schema page adds, changes, reorders and removes the variables and files of `env.schema.json`. Nothing is written until you have seen the diff, and an invalid schema is never written: the browser checks the edit with the core's own code, and the API checks it again before it writes.

### Quick path

1. Open **Schema**, then **Add variable**, or the pencil on a variable.
2. Fill the form and choose **Review changes**. A field the schema refuses shows its error, and the review does not open.
3. In the review, read the side-by-side diff (or the **Raw JSON** tab), then choose **Save**.

### What you can edit

| Area                       | Fields                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every variable             | name (a rename lists the references it rewrites), type, description, group (pick one or type a new one), comment, required, secret, empty value (`allowEmpty`), protected (`true` or with a reason, only for a secret), default and example (a select for a boolean or an enum, a number field for a number, an integer or a port) |
| Rules                      | `requiredUnless`, `conflictsWith` and `distinctFrom`, each a picker over the other variables                                                                                                                                                                                                                                       |
| string                     | `minLength`, `maxLength`, `pattern` with a live tester, `patternMessage`, `encoding`, `bytes`                                                                                                                                                                                                                                      |
| number, integer            | `min`, `max`                                                                                                                                                                                                                                                                                                                       |
| enum                       | `values`, a list to add to, reorder and remove from                                                                                                                                                                                                                                                                                |
| url                        | `protocols`                                                                                                                                                                                                                                                                                                                        |
| ipv4, ipv6, ip             | `within`, a pick of the cidr variables                                                                                                                                                                                                                                                                                             |
| cidr                       | `within`, `family`, `strict`                                                                                                                                                                                                                                                                                                       |
| boolean, email, host, port | no other options                                                                                                                                                                                                                                                                                                                   |
| A new variable             | the files with their own variable list it joins                                                                                                                                                                                                                                                                                    |
| Every file                 | path, policy (each one explained), mode, template, every variable (`*`) or an ordered pick (drag, or the arrows), header, description, and the per-file `values` and `comments`                                                                                                                                                    |

Switching a variable's type clears the options the new type does not take, and a default or example that is not a value of the new type. The form asks first and lists what it would clear.

### Removing and reordering

- **Remove a variable:** the dialog lists every place that names it (rules of other variables, file lists, per-file values and comments). Those references are removed with it (`cleanup`), so nothing is left dangling.
- **Remove a file:** the dialog lists the variables no other file holds. They stay declared, in no file; the env file stays on disk.
- **Reorder:** drag a variable, or use its arrows, then choose **Review order**. Files that take `*` write the variables in this order.

## How an edit is checked and saved

| Step          | Where   | What happens                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validate      | browser | The form's zod schema turns the form into an edit, applies it with the core's schema writer (`@configure-env/core/schema`), and puts each JSON-path error the writer reports on the field it names.                                                                                                                                           |
| Review        | browser | The diff compares the schema now with the document the edit makes, both formatted by the core's `formatJson`.                                                                                                                                                                                                                                 |
| Save          | API     | The edit goes to the schema write endpoints (`/api/schema/...`) with the fingerprint of the schema shown. A change and a rename are two writes, the second against the fingerprint the first returns. When the rename fails after the change was written, the review says so, shows the schema the change wrote, and offers the rename alone. |
| Stale (409)   | browser | The schema changed since it was read. The review shows the edit on top of the schema as it is now, and asks you to save again.                                                                                                                                                                                                                |
| Refused (422) | browser | The API's errors carry JSON paths. From a form, the review closes, and each error goes back on its form field; one with no field is listed above the form. A reorder or a removal has no form, so the review stays open and lists the errors.                                                                                                 |

`@configure-env/core/schema` is the browser-safe part of the core: the schema definitions and checks, the value checks, and the pure schema edits. The core's package index needs Node, so the portal imports only this entry. A core test keeps it free of Node built-ins.

## Tests and stories

- The tests run against the msw handlers (`src/mocks`). The schema writes there run the core's schema writer, as the API does, so a handler refuses what the API refuses. Plan and apply run over the in-memory sample project (`planOf`, `applyPlan`), and `scenarios.liveReports` computes check and validate from it, so a fix shows in the next report.
- `GET /api/events` is mocked with msw's `sse()`. jsdom has no `EventSource`, so `src/test/event-source.ts` installs the `eventsource` polyfill before the handlers load; `changeOutside(paths)` (`src/test/events.ts`) sends a `changed` event once the portal listens.
- The stories are under `Portal/Files`, `Portal/Apply`, `Portal/Check`, `Portal/Validate` and `Portal/Schema`. Run them with `pnpm storybook:web`.
