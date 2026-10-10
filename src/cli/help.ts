// The help text of each command.

import { readFileSync } from 'node:fs';
import { GENERATED_LENGTH, MIN_GENERATED_LENGTH } from './generate.ts';
import { STDIN_IDLE_MS, STDIN_MAX_BYTES } from './stdin.ts';

/** The package version, from package.json. */
export const VERSION: string = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

const GLOBAL = `Global options:
  --schema <path>  the schema file (default: env.schema.json in the root)
  --root <dir>     the project root the schema's paths are relative to
                   (default: where the command was typed)
  --state <path>   the protected variables' state, relative to the root
                   (default: .configure-env/state.json)
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
       init over an existing schema without --force, or a change to a
       protected value
  130  cancelled`;

const PROTECTED = `A protected variable keeps the value a file holds: a different value,
or removing it, exits 2 and writes nothing. So does a new value where a
file lost one that the state (.configure-env/state.json) recorded; the
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

Run configure-env <command> --help for the command's own options.

${GLOBAL}

${EXIT_CODES}`;

export const APPLY_HELP = `Usage: configure-env apply [options]

Writes the env files the schema lists, each by its policy: generate
rewrites it, merge appends the keys it lacks, create-only writes it only
when it does not exist.

In a terminal it asks which files to write, prompts for the values they
need, shows the plan and asks before writing. With --ci (or CI=true, or
--json) it never prompts: each value comes from --set, else the
environment variable of the same name, else the schema default; a required
variable with none, or a broken rule between variables (requiredUnless,
conflictsWith, distinctFrom), is an error and nothing is written.

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

Options:
  --set KEY=VALUE  a value; repeat for more
  --generate KEY   a random value for a secret string; repeat for more
  --defer KEY      write a required variable empty when it has no value;
                   repeat for more
  --replace-protected KEY
                   replace a protected value; repeat for more

${GLOBAL}

Examples:
  configure-env apply
  configure-env apply --ci --set WEB_PORT=9090
  configure-env apply --ci --generate SESSION_SECRET
  configure-env apply --ci --generate SESSION_SECRET --defer API_TOKEN
  configure-env apply --ci --file .env --json

${EXIT_CODES}`;

export const CHECK_HELP = `Usage: configure-env check [options]

Changes nothing. Reports, per file: a missing file, a generated file that
differs from the schema, the keys a merge file lacks, a mode other than
the schema's, values that break their variable's rules (secrets masked)
and lines that are not valid entries. Exits 1 when it finds any.

Generated files are compared with the --set values and the defaults, so
the result does not depend on the environment; with --use-env, also with
the environment variables, as apply --ci would write them.

Options:
  --set KEY=VALUE  a value to compare with; repeat for more
  --use-env        compare with the environment variables too

${GLOBAL}

Examples:
  configure-env check
  configure-env check --use-env
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
comment stays. Every other line stays byte for byte, and the file keeps
its mode. A key the file does not hold is reported as absent (exit 0).

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

export const VALIDATE_HELP = `Usage: configure-env validate [options]

Changes nothing. Checks the current values of every schema file (or the
--file paths): a missing file, lines that are not valid entries, required
keys that are not set, values that break their variable's rules, and
broken rules between variables (requiredUnless, conflictsWith,
distinctFrom). A
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
