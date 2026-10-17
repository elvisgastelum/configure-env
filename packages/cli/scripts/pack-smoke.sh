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

# A path as Node and tsc take it: on Windows (Git Bash) a /c/... path becomes
# C:/...; elsewhere it is unchanged.
native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
work="$(mktemp -d "${TMPDIR:-/tmp}/configure-env-smoke.XXXXXX")"

# The `serve` process, while it runs: stopped on any exit, so a failed check
# never leaves a server behind (or, on Windows, a lock on $work).
server_pid=''
stop_server() {
  if [[ -n "$server_pid" ]]; then
    node -e "try { process.kill(Number(process.argv[1]), 'SIGTERM') } catch {}" "$server_pid"
    server_pid=''
  fi
}
trap 'stop_server; rm -rf "$work"' EXIT

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
# pnpm packs as `pnpm release` (changeset publish) publishes: it replaces the
# `workspace:` ranges, which npm would leave in the manifest.
(cd "$package_dir" && pnpm pack --pack-destination "$work" >"$work/pack.txt")
tarball="$(ls "$work"/*.tgz)"
if [ -e "$package_dir/README.md" ] || [ -e "$package_dir/LICENSE" ]; then
  fail 'postpack removed the README and LICENSE copies'
else
  pass 'postpack removed the README and LICENSE copies'
fi
version="$(node -p "require('$(native "$package_dir")/package.json').version")"

contents="$(tar -tzf "$tarball")"
out="$contents"
expect 'the tarball holds the bin' '^package/dist/cli\.js$'
expect 'the tarball holds the api types' '^package/dist/index\.d\.ts$'
expect 'the tarball holds the json schema' '^package/schema/env\.schema\.v1\.json$'
expect 'the tarball holds the state migrations' '^package/dist/migrations/meta/_journal\.json$'
expect 'the tarball holds the first migration' '^package/dist/migrations/0000_[a-z_]+\.sql$'
expect 'the tarball holds the portal' '^package/dist/web/index\.html$'
expect "the tarball holds the portal's scripts" '^package/dist/web/assets/index-[A-Za-z0-9_-]+\.js$'
expect 'the tarball holds the readme' '^package/README\.md$'
expect 'the tarball holds the license' '^package/LICENSE$'
if grep -Eq '\.test\.|test-helpers|fixtures|^package/src/' <<<"$contents"; then
  fail 'the tarball holds sources, tests or fixtures'
else
  pass 'the tarball holds no sources, tests or fixtures'
fi

# @configure-env/core is private: the build inlines it, so neither the
# manifest nor the code may name it or any other workspace package.
out="$(tar -xzOf "$tarball" package/package.json)"
if grep -q 'workspace:' <<<"$out"; then
  fail 'the manifest holds a workspace: range'
else
  pass 'the manifest holds no workspace: range'
fi
expect 'the manifest depends on better-sqlite3' '"better-sqlite3": '
expect 'the manifest depends on drizzle-orm' '"drizzle-orm": '
expect 'the manifest depends on @nestjs/core' '"@nestjs/core": '
expect 'the manifest depends on @nestjs/platform-express' '"@nestjs/platform-express": '
if tar -xzOf "$tarball" $(grep -E '^package/dist/.*\.(js|d\.ts)$' <<<"$contents") |
  grep -q '@configure-env/'; then
  fail 'the build imports a workspace package'
else
  pass 'the build inlines the workspace packages'
fi

echo "== install"
app="$work/app"
mkdir -p "$app"
cd "$app"
printf '{ "name": "smoke-app", "private": true, "type": "module" }\n' >package.json
# --ignore-scripts: better-sqlite3 must load from the prebuilt binary its
# tarball ships for this platform, never from a local compile.
npm install --silent --no-audit --no-fund --prefer-offline --ignore-scripts "$(native "$tarball")"

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
    "TOKEN": { "type": "string", "secret": true, "required": true, "protected": true }
  },
  "files": [
    { "path": "config/app.env", "policy": "generate", "variables": "*" },
    { "path": "config/app.env.example", "policy": "merge", "variables": "*" }
  ]
}
JSON

# A state.json of an earlier version: the first write imports it.
mkdir -p .configure-env
node -e "
  const salt = require('node:crypto').randomBytes(32).toString('base64');
  console.log(JSON.stringify({ version: 1, salt, fingerprints: {} }));
" >.configure-env/state.json

run 1 'check before apply reports drift' cli check --ci --root "$app"
run 0 'apply --ci --set' cli apply --ci --root "$app" \
  --set PORT=9090 --set TOKEN=smoke-token-1234567890
expect 'apply creates the file' '^config/app\.env: created$'
expect 'apply creates the template' '^config/app\.env\.example: created$'
run 0 'check --ci after apply' cli check --ci --root "$app" \
  --set PORT=9090 --set TOKEN=smoke-token-1234567890
if [[ -f .configure-env/state.db ]]; then
  pass 'apply writes the state database'
else
  fail 'apply writes the state database'
fi
if [[ -e .configure-env/state.json ]]; then
  fail 'apply imports and removes state.json'
else
  pass 'apply imports and removes state.json'
fi
if grep -rqa 'smoke-token-1234567890' .configure-env; then
  fail 'the state holds a value'
else
  pass 'the state holds no value'
fi
run 2 'set refuses to change a protected value' \
  cli set TOKEN=another-token-1234567890 --ci --root "$app" --file config/app.env
run 0 'get PORT' cli get PORT --root "$app" --file config/app.env
expect 'get prints the value that was set' '^9090$'
run 1 'get a secret without --reveal' cli get TOKEN --root "$app" --file config/app.env
run 0 'check after the edits' cli check --ci --root "$app" \
  --set PORT=9090 --set TOKEN=smoke-token-1234567890
expect 'check ends with the summary' '^Everything is current\.$'
run 2 'validate is no longer a command' cli validate --root "$app"
run 1 'set rejects an invalid port' cli set PORT=http --root "$app" --file config/app.env
run 2 'a missing schema is a usage error' cli check --ci --root "$app" --schema missing.json
run 0 'install skill' cli install skill --ci --root "$app" --scope project --mode copy
expect 'install copies the skill' '^installed  \.claude/skills/configure-env \(copy\)$'
if [[ -f "$app/.claude/skills/configure-env/SKILL.md" ]]; then
  pass 'the installed skill holds SKILL.md'
else
  fail 'the installed skill holds SKILL.md'
fi

echo "== serve"
# The installed bin run by node directly, not through npx: $! is then the
# server itself, so `wait` reports its exit code.
bin="$app/node_modules/@elvisgastelum/configure-env/dist/cli.js"
node "$(native "$bin")" serve --no-open --json --root "$app" \
  >"$work/serve.json" 2>"$work/serve.err" &
job=$!
for _ in $(seq 1 120); do
  [[ -s "$work/serve.json" ]] && break
  kill -0 "$job" 2>/dev/null || break
  sleep 0.5
done
out="$(cat "$work/serve.json")"
expect 'serve --json prints {url, port, pid}' '^\{"command":"serve","url":"http://127\.0\.0\.1:[0-9]+/launch\?token=[A-Za-z0-9_-]+","port":[0-9]+,"pid":[0-9]+\}$'
if [[ -n "$out" ]]; then
  # The pid the server reports is the one Node can signal on every OS.
  server_pid="$(node -p 'JSON.parse(process.argv[1]).pid' "$out")"
  run 0 'serve answers its token' node --input-type=module -e "
    const launch = new URL(JSON.parse(process.argv[1]).url);
    const token = launch.searchParams.get('token');
    const at = (path) => new URL(path, launch);
    const health = await fetch(at('/api/health'), {
      headers: { authorization: 'Bearer ' + token },
    });
    console.log('health', health.status, JSON.stringify(await health.json()));
    console.log('anonymous', (await fetch(at('/api/health'))).status);
    const page = await fetch(at('/'), {
      headers: { authorization: 'Bearer ' + token, accept: 'text/html' },
    });
    const html = await page.text();
    console.log('index', page.status, /<div id=\"root\">/.test(html) ? 'portal' : html.slice(0, 80));
  " "$out"
  expect '/api/health answers 200 with the token' '^health 200 '
  expect '/api/health answers 401 without the token' '^anonymous 401$'
  expect 'the portal index loads' '^index 200 portal$'
  stop_server
  code=0
  wait "$job" || code=$?
  if command -v cygpath >/dev/null 2>&1; then
    # Windows has no SIGTERM to catch: process.kill ends the process.
    pass "serve stopped (exit $code)"
  elif [[ "$code" == 0 ]]; then
    pass 'serve stops on SIGTERM (exit 0)'
  else
    fail "serve stops on SIGTERM: exit $code, expected 0"
    sed 's/^/      /' "$work/serve.err" >&2
  fi
else
  fail 'serve started'
  sed 's/^/      /' "$work/serve.err" >&2
  kill "$job" 2>/dev/null || true
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
    "typeRoots": ["$(native "$package_dir")/node_modules/@types"]
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
