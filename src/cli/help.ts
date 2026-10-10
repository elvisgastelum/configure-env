// The help text of each command.

import { readFileSync } from 'node:fs';

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
  --file <path>    only this schema file; repeat for more
  --ci             never prompt; also when CI=true
  --json           print one JSON document on stdout; logs go to stderr
  --no-color       plain output; NO_COLOR is honoured too
  -h, --help       show the help
  -v, --version    show the version`;

const EXIT_CODES = `Exit codes:
  0    ok
  1    drift, an invalid value or schema, a failed write, or an
       existing schema without --force
  2    usage error: a bad option, no schema, or no terminal without --ci
  130  cancelled`;

export const MAIN_HELP = `Usage: configure-env [command] [options]

Configure and check env files from a schema (env.schema.json), in a
terminal UI or unattended with --ci.

Commands:
  apply   write the env files the schema describes (the default)
  check   change nothing; report drift and invalid values
  init    write a starting env.schema.json, inferred from .env.example

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
variable with none is an error and nothing is written.

Options:
  --set KEY=VALUE  a value; repeat for more

${GLOBAL}

Examples:
  configure-env apply
  configure-env apply --ci --set WEB_PORT=9090
  configure-env apply --ci --file .env --json

${EXIT_CODES}`;

export const CHECK_HELP = `Usage: configure-env check [options]

Changes nothing. Reports, per file: a missing file, a generated file that
differs from the schema, the keys a merge file lacks, a mode other than
the schema's, values that break their variable's rules (secrets masked)
and lines that are not valid entries. Exits 1 when it finds any.

Generated files are compared with the values from --set and the
environment, as apply --ci would write them.

Options:
  --set KEY=VALUE  a value to compare with; repeat for more

${GLOBAL}

Examples:
  configure-env check
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
