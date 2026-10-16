// The help text of each command.

import { readFileSync } from 'node:fs';
import { GENERATED_LENGTH, MIN_GENERATED_LENGTH } from './generate.ts';
import { PACKAGE_ROOT } from './package-root.ts';
import { STDIN_IDLE_MS, STDIN_MAX_BYTES } from './stdin.ts';

/** The package version, from package.json. */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('package.json', PACKAGE_ROOT), 'utf8')) as {
    version: string;
  }
).version;

const GLOBAL = `Global options:
  --schema <path>  the schema file (default: env.schema.json in the root)
  --root <dir>     the project root the schema's paths are relative to
                   (default: where the command was typed)
  --state <path>   the protected variables' state, relative to the root
                   (default: .configure-env/state.db)
  --file <path>    only this schema file; repeat for more (set, get and
                   unset take one; it defaults to the only file that is
                   not a template)
  --ci             never prompt; also when CI=true
  --json           print one JSON document on stdout; logs go to stderr
  --no-color       plain output; NO_COLOR is honoured too
  -h, --help       show the help
  -v, --version    show the version`;

const EXIT_CODES = `Exit codes:
  0    ok
  1    drift, an invalid value or schema, or a failed write
  2    usage error: a bad option, no schema, no terminal without --ci,
       init or install over an existing one without --force, or a
       change to a protected value
  130  cancelled`;

const PROTECTED = `A protected variable keeps the value a file holds: a different value,
or removing it, exits 2 and writes nothing. So does a new value where a
file lost one that the state (.configure-env/state.db) recorded; the
recorded value itself is taken back. --replace-protected KEY allows the
change: in a terminal you type KEY to confirm, with --ci or --json the
flag is enough.`;

export const MAIN_HELP = `Usage: configure-env [command] [options]

Configure and check env files from a schema (env.schema.json), in a
terminal UI or unattended with --ci.

Commands:
  apply     write the env files the schema describes (the default)
  check     change nothing; report drift and invalid values
  init      write a starting env.schema.json, inferred from .env.example
  set       set variables in one file, keeping every other line
  get       print one variable's value
  unset     remove variables from one file
  list      show each file's variables: set, valid, value (secrets masked)
  validate  check the current values against the schema
  history   list the latest changes the CLI and the portal made
  install   install the agent skill: configure-env install skill
  serve     start the local portal for the project in a browser

Run configure-env <command> --help for the command's own options.

${GLOBAL}

${EXIT_CODES}`;

export const APPLY_HELP = `Usage: configure-env apply [options]

Writes the env files the schema lists, each by its policy: generate
rewrites it, merge appends the keys it lacks, create-only writes it only
when it does not exist.

An existing file whose content needs no change but whose mode differs
from the schema's mode gets a chmod only, never a rewrite: mode fixed
(644 → 600). It needs no value. apply never adds a permission: a schema
mode that would is refused for that file, mode not loosened (400, schema
says 600), and the run exits 1.

In a terminal it asks which files to write, prompts for the values they
need, shows the plan and asks before writing. With --ci (or CI=true, or
--json) it never prompts: each value comes from --set, else the
environment variable of the same name, else the schema default; a required
variable with none, or a broken rule between variables (requiredUnless,
conflictsWith, distinctFrom, within), is an error and nothing is written.

Template files (template: true, or a path ending in .example, .sample or
.template) take only their values entries and the defaults: never --set,
environment or prompted values, so no secret reaches a committed file. No
prompt is shown for a variable only template files need.

--generate KEY puts a random value in place of a secret string variable,
one per run, never printed; a value the run's files already hold is used
instead. It lands only where a file lacks the key, so it cannot take a key
that a chosen generate file writes, or one that a file of the run would
hold with its conflictsWith partner set. A maxLength under ${MIN_GENERATED_LENGTH} exits 2.

${PROTECTED}

--defer KEY leaves a required (or requiredUnless) variable for a person: with no value, it is
written empty instead of failing the run, not prompted for, and reported,
so it can be set later with set --prompt KEY or set --stdin KEY. An
optional or undeclared variable, or one also given with --set or
--generate, exits 2.

--prune removes the keys a merge or existing create-only file holds that
the schema does not list for it, each with the # lines directly above it
and the blank line that set them apart: pruned keys: A, B. A pruned key's
protected fingerprint goes too. Without it, apply keeps every key.

Options:
  --set KEY=VALUE  a value; repeat for more
  --generate KEY   a random value for a secret string; repeat for more
  --defer KEY      write a required variable empty when it has no value;
                   repeat for more
  --replace-protected KEY
                   replace a protected value; repeat for more
  --prune          remove the keys the schema does not list for a file

${GLOBAL}

Examples:
  configure-env apply
  configure-env apply --ci --set WEB_PORT=9090
  configure-env apply --ci --generate SESSION_SECRET
  configure-env apply --ci --generate SESSION_SECRET --defer API_TOKEN
  configure-env apply --ci --prune
  configure-env apply --ci --file .env --json

${EXIT_CODES}`;

export const CHECK_HELP = `Usage: configure-env check [options]

Changes nothing. Reports, per file: a missing file, a generated file that
differs from the schema, the keys a merge file lacks, a mode other than
the schema's (apply fixes it when it only removes permissions), values that break their variable's rules (secrets masked),
lines that are not valid entries, and protected values that no longer
match the ones the state recorded. With --strict, the keys a merge or
create-only file holds that the schema does not list for it too, which
apply --prune removes. Exits 1 when it finds any.

Generated files are compared with the --set values and the defaults, so
the result does not depend on the environment; with --use-env, also with
the environment variables, as apply --ci would write them.

Options:
  --set KEY=VALUE  a value to compare with; repeat for more
  --use-env        compare with the environment variables too
  --strict         report the keys the schema does not list as drift

${GLOBAL}

Examples:
  configure-env check
  configure-env check --use-env
  configure-env check --ci --strict
  configure-env check --ci --json

${EXIT_CODES}`;

export const INIT_HELP = `Usage: configure-env init [options]

Writes env.schema.json (or --schema) in the root, with $schema pointing at
the published JSON Schema for editor support. It never overwrites an
existing schema unless --force.

The variables are inferred from --from, else from .env.example when it
exists: the type from each value (a whole number is an integer, true and
false a boolean, then email, URL and IPv4 host patterns, else a string),
the comment from the comment lines just above the key, and the default
from the value. The file goes in the schema with policy merge. Without an
example file, the schema starts empty.

In a terminal it shows the inferred types and lets you keep or change
each one; with --ci (or --json) it writes them as inferred.

Once the schema is written, it adds .configure-env/ (where the protected
variables' state lives) to .gitignore, creating it when missing.

Options:
  --from <file>  the env file to infer from, inside the root
                 (default: .env.example when it exists)
  --force        overwrite an existing schema

${GLOBAL}

Examples:
  configure-env init
  configure-env init --ci --from config/app.env.example
  configure-env init --force

${EXIT_CODES}`;

const FILE_CHOICE = `The file is --file, else the only schema file that is not a template;
with more than one, --file is required.`;

export const SET_HELP = `Usage: configure-env set KEY=VALUE [KEY=VALUE...] [options]

Sets variables in one env file. Each value is checked against its
variable's rules first: one invalid value writes nothing (exit 1). A key
the file holds is edited in place, keeping its export prefix, spacing and
inline comment; a missing key is appended with its schema comment. Every
other line stays byte for byte, and the file keeps its mode. Each key is
reported as updated, added or unchanged, secrets masked.

--generate KEY writes a random value for a secret string variable (${GENERATED_LENGTH}
characters of [A-Za-z0-9_-], within minLength and maxLength; a maxLength
under ${MIN_GENERATED_LENGTH} exits 2); a key that already has a value keeps it, and one to
make whose conflictsWith partner the file holds exits 2. --stdin
KEY reads one value from stdin, one trailing newline stripped, so a secret
never goes through argv. An empty stdin, as a failed command in the pipe
leaves, writes nothing (exit 1); so does input past ${STDIN_MAX_BYTES / 1024} KiB. ${STDIN_IDLE_MS / 1000}s
with no new input exits 2, as does a pipe that sends the value but never
closes.

${FILE_CHOICE} A template file is
edited only with --allow-template, and never with --generate or --stdin.

${PROTECTED}

Options:
  --prompt KEY      ask for the value in the terminal (hidden for a
                    secret); repeat for more
  --generate KEY    a random value for a secret string, unless it is set;
                    repeat for more
  --stdin KEY       read the value from stdin, which must not be a
                    terminal
  --create          create the file when it does not exist, with the
                    schema's mode
  --allow-unknown   set a key that is not one of the file's variables
  --allow-template  edit a template file
  --replace-protected KEY
                    replace a protected value; repeat for more

${GLOBAL}

Examples:
  configure-env set WEB_PORT=9090
  configure-env set --file .env API_TOKEN=abc123 MODE=prod
  configure-env set --prompt API_TOKEN
  configure-env set --generate SESSION_SECRET
  op read op://dev/api/token | configure-env set --stdin API_TOKEN
  configure-env set --create --file .env WEB_HOST=10.0.0.5

${EXIT_CODES}`;

export const GET_HELP = `Usage: configure-env get KEY [options]

Prints the value of one variable, unquoted, as the file holds it. A key
that is not set exits 1. A secret is not printed (exit 1) unless
--reveal; with --json it shows masked instead.

${FILE_CHOICE}

Options:
  --reveal  print a secret value

With --json it prints {"key", "value", "set"}, or "masked" in place of
"value" for a secret without --reveal.

${GLOBAL}

Examples:
  configure-env get WEB_PORT
  configure-env get API_TOKEN --reveal
  configure-env get WEB_HOST --file .env --json

${EXIT_CODES}`;

export const UNSET_HELP = `Usage: configure-env unset KEY [KEY...] [options]

Removes variables from one env file. The comment lines right above a key
go with it only when they are exactly its schema comment; any other
comment stays. The blank line that set them apart goes too, so no blank
line is left doubled, leading or trailing. Every other line stays byte
for byte, and the file keeps its mode. A key the file does not hold is reported as absent (exit 0).

${FILE_CHOICE} A template file is
edited only with --allow-template.

${PROTECTED}

Options:
  --allow-template  edit a template file
  --replace-protected KEY
                    remove a protected value; repeat for more

${GLOBAL}

Examples:
  configure-env unset WEB_PORT
  configure-env unset --file .env API_TOKEN MODE

${EXIT_CODES}`;

export const LIST_HELP = `Usage: configure-env list [options]

Shows, per schema file, a table of its variables:

  KEY          the name
  SET          yes, no, or empty
  VALID        ok, or the rule the value breaks; - in a template, whose
               values are placeholders; unknown for a key the schema
               does not list for the file
  VALUE        the value, masked for a secret, cut at 40 characters
  DESCRIPTION  the variable's description

Without --file it lists every file, grouped by path. With --json it prints
one array: per variable {"file", "key", "set", "valid", "error",
"value" or "masked", "description", "unknown"}. Changes nothing; exits 0.

${GLOBAL}

Examples:
  configure-env list
  configure-env list --file .env
  configure-env list --json

${EXIT_CODES}`;

export const HISTORY_HELP = `Usage: configure-env history [options]

Lists the 20 latest changes recorded in the history of edits
(.configure-env/state.db), newest first: every set, unset, apply and
init, and every edit made in the portal (configure-env serve).

  ID          the change's number; the portal undoes a change by it
  WHEN (UTC)  when it was made
  BY          cli or portal
  CHANGE      set, unset, replace (a protected value replaced) or schema
              (the schema file written); an undo names the change it undid
  FILE        the env file, or the schema file
  KEY         the variable; - for the schema
  BEFORE      the value before, cut at 30 characters; masked for a
              secret, whose value is never stored; - when it was not set;
              for the schema, how many variables and files it had
  AFTER       the same, after

With --json it prints {"command", "ok", "total", "changes": [{"id",
"at", "actor", "file", "key", "operation", "before", "after",
"restorable", "undoBlocker", "undoOf"}]}; "total" counts every change
recorded. Changes nothing; exits 0, or 1 when the history cannot be read.
Undo stays in the portal for now: its History page undoes a change while
the file still holds what the change wrote. A secret's change can't be
undone.

${GLOBAL}

Examples:
  configure-env history
  configure-env history --json

${EXIT_CODES}`;

export const VALIDATE_HELP = `Usage: configure-env validate [options]

Changes nothing. Checks the current values of every schema file (or the
--file paths): a missing file, lines that are not valid entries, required
keys that are not set, values that break their variable's rules, and
broken rules between variables (requiredUnless, conflictsWith,
distinctFrom, within), and protected values that no longer match the
ones the state recorded. It reads the state, never writes it. A
key the schema does not list for the file is a warning, an error with
--strict. Template files hold placeholders, so only their lines and the
presence of each key are checked. Exits 1 on any error; messages never
show a value.

Options:
  --strict  treat unknown keys as errors

${GLOBAL}

Examples:
  configure-env validate
  configure-env validate --file .env --strict
  configure-env validate --json

${EXIT_CODES}`;

export const INSTALL_HELP = `Usage: configure-env install skill [options]

Installs the agent skill the package ships (skills/configure-env), which
teaches an agent to work with env files through configure-env, for each
--agent:

  claude  .claude/skills/configure-env
  agents  .agents/skills/configure-env

--scope picks where:

  project  in the project, to commit: the git top level of the root, else
           the root
  local    in the project, kept out of git: the path is added once to
           .git/info/exclude; outside a git repository it exits 2
  user     in your home folder, for every project

--mode picks how: copy writes the files, which a fresh clone keeps;
symlink links to the package's folder, which follows package upgrades but
breaks when that folder goes away (an npx cache, a removed node_modules).

A path that exists is never replaced without --force (exit 2), except what
the mode would make: a symlink to the same folder, or with copy a folder
identical to the skill (same files and bytes); either is reported unchanged
and left as it is, with --force too. --force builds the new one next to it
and swaps it in, so a failure keeps the old one; a symlink is removed, never
what it points at. If the old one cannot be put back, the error names where
it was left; if it cannot be removed after the swap, a warning names it, to
delete. A run that fails part-way exits 1 and still prints the skills it
installed, which stay.

local needs a .git folder, or a .git file (a worktree, a submodule or
git init --separate-git-dir), that leads to a git dir: HEAD, objects and
refs, as git checks; a worktree's or submodule's git dir must name it
back. Any other .git counts as no repository.

In a terminal it asks for the scope, the mode and the agents the options
leave out; with --ci, --json or no terminal they default to project, copy
and claude.

Options:
  --scope <scope>  project, local or user
  --mode <mode>    copy or symlink
  --agent <agent>  claude or agents; repeat for both (default: claude)
  --force          replace an existing skill folder or link

Global options:
  --root <dir>  the project (default: where the command was typed)
  --ci          never prompt; also when CI=true
  --json        print one JSON document on stdout
  --no-color    plain output; NO_COLOR is honoured too
  -h, --help    show the help

Examples:
  configure-env install skill
  configure-env install skill --ci --scope project --mode copy
  configure-env install skill --scope local --mode symlink --agent claude --agent agents
  configure-env install skill --scope user --force

${EXIT_CODES}`;

export const SERVE_HELP = `Usage: configure-env serve [options]

Starts the local portal for the project: the configure-env API with the
web app, on this machine, until Ctrl-C (SIGINT) or SIGTERM, which stop it
and exit 0.

Every run makes a fresh random token. Only requests that carry it reach
the API: the printed URL holds it and, opened in a browser, trades it for
a session cookie. Anyone with that URL can read and change the project's
env files while the server runs, so do not share it.

It binds 127.0.0.1 by default. A host that is not a loopback address
(127.x.x.x, ::1, localhost) is refused (exit 2) unless --unsafe-expose is
given, and then serves with a warning.

Without --port it takes the first free port from 4747. A taken --port
exits 1.

In a terminal it opens the URL in the default browser; --open and
--no-open decide instead. With --json it prints one line,
{"command":"serve","url":...,"port":...,"pid":...}, where url holds the
token, and does not open a browser unless --open is given.

Options:
  --port <port>    the port (default: the first free one from 4747;
                   0: any free port)
  --host <host>    the address to bind (default: 127.0.0.1)
  --unsafe-expose  allow a --host that other machines can reach
  --open           open the browser, also without a terminal
  --no-open        never open the browser

Global options:
  --schema <path>  the schema file (default: env.schema.json in the root);
                   it must lie inside the root
  --root <dir>     the project (default: where the command was typed)
  --json           print {command, url, port, pid} on stdout
  --no-color       plain output; NO_COLOR is honoured too
  -h, --help       show the help

Examples:
  configure-env serve
  configure-env serve --port 5000 --no-open
  configure-env serve --json --no-open
  configure-env serve --host 0.0.0.0 --unsafe-expose

${EXIT_CODES}`;
