#!/usr/bin/env bash
# Packs the package the way npm publishes it, installs the tarball into a
# throwaway project and runs the installed CLI through npx, so a broken bin,
# a missing file or a bad `exports` entry fails here and not after publishing.
#
#   pnpm smoke
#
# Everything happens in temporary directories that a trap removes; nothing
# in the checkout is written except the build output (`prepack` builds).

set -euo pipefail

# The package npm packs (packages/cli), not the repository root.
package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/configure-env-smoke.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# A pnpm script sets INIT_CWD to the checkout, and the CLI treats INIT_CWD as
# the project root; clear it so nothing below can point at the checkout.
unset INIT_CWD

failures=0
pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1" >&2
  failures=$((failures + 1))
}

# run <expected exit code> <description> <command...>: runs the command,
# keeps its stdout in $out, and checks the exit code.
out=''
run() {
  local expected="$1" what="$2" code=0
  shift 2
  out="$("$@" 2>"$work/stderr")" || code=$?
  if [[ "$code" == "$expected" ]]; then
    pass "$what (exit $code)"
  else
    fail "$what: exit $code, expected $expected"
    sed 's/^/      /' "$work/stderr" >&2
  fi
}

# expect <description> <pattern>: checks $out against an extended regex.
expect() {
  if grep -Eq -- "$2" <<<"$out"; then
    pass "$1"
  else
    fail "$1: output did not match /$2/"
    sed 's/^/      /' <<<"$out" >&2
  fi
}

echo "== pack"
(cd "$package_dir" && npm pack --silent --pack-destination "$work" >"$work/pack.txt")
tarball="$work/$(tail -n 1 "$work/pack.txt")"
if [ -e "$package_dir/README.md" ] || [ -e "$package_dir/LICENSE" ]; then
  fail 'postpack removed the README and LICENSE copies'
else
  pass 'postpack removed the README and LICENSE copies'
fi
version="$(node -p "require('$package_dir/package.json').version")"

contents="$(tar -tzf "$tarball")"
out="$contents"
expect 'the tarball holds the bin' '^package/dist/cli\.js$'
expect 'the tarball holds the api types' '^package/dist/index\.d\.ts$'
expect 'the tarball holds the json schema' '^package/schema/env\.schema\.v1\.json$'
expect 'the tarball holds the readme' '^package/README\.md$'
expect 'the tarball holds the license' '^package/LICENSE$'
if grep -Eq '\.test\.|test-helpers|fixtures|^package/src/' <<<"$contents"; then
  fail 'the tarball holds sources, tests or fixtures'
else
  pass 'the tarball holds no sources, tests or fixtures'
fi

echo "== install"
app="$work/app"
mkdir -p "$app"
cd "$app"
printf '{ "name": "smoke-app", "private": true, "type": "module" }\n' >package.json
npm install --silent --no-audit --no-fund --prefer-offline "$tarball"

cli() { npx --no-install configure-env "$@"; }

echo "== cli"
run 0 '--help' cli --help
expect '--help prints the usage' '^Usage: configure-env'
run 0 '--version' cli --version
expect "--version prints $version" "^${version//./\\.}$"

mkdir -p config
cat >env.schema.json <<'JSON'
{
  "version": 1,
  "variables": {
    "PORT": { "type": "port", "default": 8080 },
    "MODE": { "type": "enum", "values": ["dev", "prod"], "default": "dev" },
    "TOKEN": { "type": "string", "secret": true, "required": true }
  },
  "files": [
    { "path": "config/app.env", "policy": "generate", "variables": "*" },
    { "path": "config/app.env.example", "policy": "merge", "variables": "*" }
  ]
}
JSON

run 1 'check before apply reports drift' cli check --ci --root "$app"
run 0 'apply --ci --set' cli apply --ci --root "$app" \
  --set PORT=9090 --set TOKEN=smoke-token-1234567890
expect 'apply creates the file' '^config/app\.env: created$'
expect 'apply creates the template' '^config/app\.env\.example: created$'
run 0 'check --ci after apply' cli check --ci --root "$app" \
  --set PORT=9090 --set TOKEN=smoke-token-1234567890
run 0 'get PORT' cli get PORT --root "$app" --file config/app.env
expect 'get prints the value that was set' '^9090$'
run 1 'get a secret without --reveal' cli get TOKEN --root "$app" --file config/app.env
run 0 'validate' cli validate --root "$app"
run 1 'set rejects an invalid port' cli set PORT=http --root "$app" --file config/app.env
run 2 'a missing schema is a usage error' cli check --ci --root "$app" --schema missing.json
run 0 'install skill' cli install skill --ci --root "$app" --scope project --mode copy
expect 'install copies the skill' '^installed  \.claude/skills/configure-env \(copy\)$'
if [[ -f "$app/.claude/skills/configure-env/SKILL.md" ]]; then
  pass 'the installed skill holds SKILL.md'
else
  fail 'the installed skill holds SKILL.md'
fi

echo "== api"
run 0 'import the api' node --input-type=module -e "
  import { parseSchema, parseDotenv, getValue } from '@elvisgastelum/configure-env';
  import schema from '@elvisgastelum/configure-env/schema.json' with { type: 'json' };
  const result = parseSchema({ version: 1, variables: {}, files: [] });
  if (!result.ok) process.exit(1);
  console.log(getValue(parseDotenv('A=1\n'), 'A'), typeof schema.\$id);
"
expect 'the api and the schema export load' '^1 string$'

cat >check-types.ts <<'TS'
import {
  type EnvSchema,
  checkDrift,
  parseSchema,
} from '@elvisgastelum/configure-env';

const result = parseSchema({});
if (result.ok) {
  const schema: EnvSchema = result.schema;
  void checkDrift({ schema, root: '.' });
}
TS
cat >tsconfig.json <<JSON
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "types": ["node"],
    "typeRoots": ["$package_dir/node_modules/@types"]
  },
  "files": ["check-types.ts"]
}
JSON
run 0 'the published types check' "$package_dir/node_modules/.bin/tsc" -p .

echo
if ((failures)); then
  echo "smoke: $failures check(s) failed" >&2
  exit 1
fi
echo "smoke: all checks passed ($(basename "$tarball"))"
