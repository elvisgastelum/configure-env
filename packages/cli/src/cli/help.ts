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
  1    a check error (drift, an invalid value or line, a broken rule),
       an invalid schema, or a failed write
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
  check     report every problem by file: drift, invalid values and
            lines, broken rules, unknown keys, what git does not ignore;
            changes nothing but the git-ignore lines it may fix
  init      write a starting env.schema.json, inferred from .env.example
  set       set variables in one file, keeping every other line
  get       print one variable's value
  unset     remove variables from one file
  list      show each file's variables: set, valid, value (secrets masked)
  history   list the latest changes the CLI and the portal made
  install   install the agent skill or register the MCP server:
            configure-env install skill, configure-env install mcp
  serve     start the local portal for the project in a browser
  mcp       serve the env files to an agent over MCP, secrets masked

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

Changes nothing, unless it fixes git-ignore problems. Prints one report of
every problem, by file in schema order, each an error or a warning:

  missing        a file that does not exist (create-only and templates too)
  differs        a generated file whose content differs from the schema
  missing key    a key a merge file or a template lacks
  mode           a mode other than the schema's (apply fixes it when it
                 only removes permissions)
  refused        a path that leaves the root
  invalid line   a line that is not a valid entry
  invalid value  a value that breaks its variable's rules, a required one
                 unset or empty included (secrets masked)
  rule           a broken rule between variables (requiredUnless,
                 conflictsWith, distinctFrom, within)
  protected      a protected value that no longer matches the one the
                 state recorded; the state is read, never written
  unknown key    a key the schema does not list for the file: a warning,
                 an error with --strict; apply --prune removes it

Then what git could commit that it must not, each an error:

  state not ignored  the state folder (.configure-env/) has no .gitignore
                     of its own, or it lacks one of the state's files
  not ignored        in a git work tree, an env file that holds real
                     values (not a template) the repository does not ignore

In a terminal it offers to fix them, each selected first; --fix fixes
them without asking. A fix adds the missing lines: to the state folder's
.gitignore, or /<path> to the root's. A .gitignore that is a symlink is
never written.

Templates hold placeholders, so only their lines and keys are checked.
Messages never show a value. Without --json, one line per problem,
\`path: ok\` for a file without any, then the counts. Exits 1 on any
error; warnings alone exit 0.

Generated files are compared with the --set values and the defaults, so
the result does not depend on the environment; with --use-env, also with
the environment variables, as apply --ci would write them.

Options:
  --set KEY=VALUE  a value to compare with; repeat for more
  --use-env        compare with the environment variables too
  --strict         report the keys the schema does not list as errors
  --fix            add the missing git-ignore lines without asking

${GLOBAL}

Examples:
  configure-env check
  configure-env check --use-env
  configure-env check --ci --strict
  configure-env check --file .env --strict
  configure-env check --ci --json
  configure-env check --ci --fix

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

export const INSTALL_HELP = `Usage: configure-env install skill [options]
       configure-env install mcp [options]

install skill
-------------

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

Options for install skill:
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

install mcp
-----------
Registers configure-env mcp, the MCP server for agents, as the server
configure-env in each --agent's configuration, keeping every other entry:

  agent   project                 user
  claude  .mcp.json               ~/.claude.json
  cursor  .cursor/mcp.json        ~/.cursor/mcp.json
  vscode  .vscode/mcp.json        VS Code's user folder, mcp.json
  codex   .codex/config.toml      ~/.codex/config.toml
  gemini  .gemini/settings.json   ~/.gemini/settings.json

--scope is project (the git top level of the root, else the root; to
commit) or user (your home folder, for every project). --runner picks the
command the agents start: npx (npx -y @elvisgastelum/configure-env mcp,
the default) or global (configure-env mcp, installed on the PATH). VS Code
also gets --root \${workspaceFolder}; the others start it in the project.

A server already registered the same way is reported unchanged; a
different one is never replaced without --force (exit 2). A configuration
that is not plain JSON (VS Code's may hold comments) is refused, exit 2,
and so is a Codex config.toml that registers configure-env other than as
its own [mcp_servers.configure-env] table.
Every file is checked before any is written, and each is written whole
next to itself and renamed into place, keeping its mode. A symlink is
written where it points, and stays, when it points inside the project
(project) or the home folder (user); else it exits 2. Two agents sharing
one file write it once, or exit 2 when they would register the server
differently. A file another program changes meanwhile is left alone
(exit 1). When a write fails, the files the run already wrote are put
back as they were (exit 1).

In a terminal it asks for the scope, the agents and the runner the options
leave out; with --ci, --json or no terminal they default to project,
claude and npx.

Options for install mcp:
  --scope <scope>    project or user
  --agent <agent>    claude, cursor, vscode, codex or gemini; repeat for
                     more (default: claude)
  --runner <runner>  npx or global
  --force            replace a different configure-env server

Examples:
  configure-env install skill
  configure-env install skill --ci --scope project --mode copy
  configure-env install skill --scope local --mode symlink --agent claude --agent agents
  configure-env install skill --scope user --force
  configure-env install mcp
  configure-env install mcp --ci --scope project --agent claude --agent cursor
  configure-env install mcp --scope user --agent codex --runner global

${EXIT_CODES}`;

export const SERVE_HELP = `Usage: configure-env serve [options]

Starts the local portal for the project: the configure-env API with the
web app, on this machine, until Ctrl-C (SIGINT) or SIGTERM, which stop it
and exit 0.

Every run makes a fresh random token. Only requests that carry it reach
the API: the printed URL holds it and, opened in a browser, trades it for
a session cookie. Anyone with that URL can read and change the project's
env files while the server runs, so do not share it.

It runs without a schema too: the portal then offers to init one from
.env.example, as configure-env init does. An invalid schema exits 1.

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

export const MCP_HELP = `Usage: configure-env mcp [options]

Runs a Model Context Protocol server for the project on stdin and stdout,
for an agent (Claude Code, Cursor, VS Code, Codex, Gemini CLI) to start.
It stops when the client closes the connection.

Its tools run the configure-env commands with --ci --json, so they keep
their checks and guards:

  read   list_variables, get_value, check, history, get_schema
  write  set_values, generate_secret, unset, apply, fix_gitignore,
         update_schema
  ask    request_secret

No tool returns a secret's value: they mask it, and none reveals one.
A key the schema does not declare has its value masked in its entry.
set_values refuses a secret variable, and update_schema a schema that
would remove a secret variable or its "secret": true, or show a value a
schema file already holds: a key declared without it, or a newly listed
file's values. A secret goes in only through a value the server
generates (generate_secret, apply's generate), or one the user types in a
terminal with the command request_secret answers, which runs from any
folder: configure-env set --root <root> --prompt KEY.

Register it with configure-env install mcp, or in an agent's MCP
configuration as the command configure-env with the argument mcp.

${GLOBAL}

Examples:
  configure-env mcp
  configure-env mcp --root ./service --schema ./service/env.schema.json

${EXIT_CODES}`;
