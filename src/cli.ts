// `pnpm configure:env`: writes the env example files, interactively (a TUI)
// or unattended (--ci). See the README, "Env files".
import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { applyPlan } from './engine/apply.ts';
import { checkDrift } from './engine/check.ts';
import { validateValues } from './engine/plan.ts';
import { type InteractiveContext, runInteractive } from './interactive.ts';
import {
  describeDrift,
  describeFailure,
  describeFile,
  examplePaths,
  loadBuiltinSchema,
  localPaths,
  planRun,
} from './run.ts';

/** The built-in schema: the elvisgastelum.com env setup. */
const SCHEMA = loadBuiltinSchema();

const OPTIONS = {
  check: { type: 'boolean' },
  local: { type: 'boolean' },
  ci: { type: 'boolean' },
  root: { type: 'string' },
  'web-host': { type: 'string' },
  'web-port': { type: 'string' },
  'contact-email': { type: 'string' },
  'contact-whatsapp': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

/** The value flags and the variable each one sets. */
const VALUE_FLAGS = {
  'web-host': 'WEB_HOST',
  'web-port': 'WEB_PORT',
  'contact-email': 'VITE_CONTACT_EMAIL',
  'contact-whatsapp': 'VITE_CONTACT_WHATSAPP',
} as const satisfies Record<string, string>;

type ValueKey = (typeof VALUE_FLAGS)[keyof typeof VALUE_FLAGS];
export type EnvValues = Record<ValueKey, string>;
export type ValueFlags = Partial<Record<keyof typeof VALUE_FLAGS, string>>;

/** The schema defaults of the value flags' variables, as env file text. */
export const DEFAULT_VALUES: Readonly<EnvValues> = Object.fromEntries(
  Object.values(VALUE_FLAGS).map((key) => [
    key,
    String(SCHEMA.variables[key]?.default ?? ''),
  ]),
) as EnvValues;

const USAGE = `Usage: pnpm configure:env [--ci] [--check] [--local] [--root <dir>]
                          [--web-host <host>] [--web-port <port>]
                          [--contact-email <email>] [--contact-whatsapp <digits|off>]

Writes deploy/.env.production.example (always rewritten from the schema)
and .env.example (gains only the keys it lacks), as the built-in schema
examples/portfolio.env.schema.json describes them.

  --ci          never prompt (also when CI=true); required without a TTY
  --check       change nothing; list the drift and exit 1 when out of date
  --local       --ci only: also create .env (mode 600) when it is missing
  --root <dir>  the directory holding the files (default: the current
                directory)
  --web-host, --web-port, --contact-email, --contact-whatsapp
                the .env values; each falls back to the environment variable
                of the same name (WEB_HOST, WEB_PORT, VITE_CONTACT_EMAIL,
                VITE_CONTACT_WHATSAPP), then to the default
  -h, --help    show this help

Exit codes: 0 ok, 1 drift, an invalid value or a failed write, 2 usage
error, 130 cancelled.`;

export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Whether stdin and stdout are both terminals. */
  isTTY: boolean;
  /** The default --root, and what a relative --root resolves against. */
  cwd: string;
  /** The TUI; replaceable in tests. */
  interactive?: (context: InteractiveContext) => Promise<number>;
}

/** Each value: its flag, else its non-empty environment variable, else the default. */
export function resolveValues(flags: ValueFlags, env: Io['env']): EnvValues {
  const values = { ...DEFAULT_VALUES };
  for (const [flag, key] of Object.entries(VALUE_FLAGS)) {
    const fromFlag = flags[flag as keyof ValueFlags];
    const fromEnv = env[key] || undefined;
    values[key] = fromFlag ?? fromEnv ?? DEFAULT_VALUES[key];
  }
  return values;
}

const isCiEnv = (env: Io['env']) =>
  Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0';

const isDirectory = (path: string) =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

function usageError(io: Io, message: string): number {
  io.stderr(USAGE);
  io.stderr(`configure-env: ${message}`);
  return 2;
}

export async function main(argv: string[], io: Io): Promise<number> {
  // `pnpm <script> -- args` can pass the separator through.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let options;
  try {
    ({ values: options } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }

  const root = resolve(io.cwd, options.root ?? '.');
  if (!(await isDirectory(root))) {
    io.stderr(`configure-env: no such directory: ${root}`);
    return 2;
  }
  const flags: ValueFlags = Object.fromEntries(
    Object.keys(VALUE_FLAGS).flatMap((flag) => {
      const value = options[flag as keyof ValueFlags];
      return value === undefined ? [] : [[flag, value]];
    }),
  );
  const values = resolveValues(flags, io.env);
  const check = Boolean(options.check);

  if (!options.ci && !isCiEnv(io.env)) {
    if (!io.isTTY) {
      io.stderr(
        'configure-env: no terminal for the interactive mode; pass --ci (or set CI=true) to run unattended',
      );
      return 2;
    }
    return (io.interactive ?? runInteractive)({
      schema: SCHEMA,
      root,
      check,
      values,
    });
  }

  if (check) {
    const report = await checkDrift({
      schema: SCHEMA,
      root,
      files: examplePaths(SCHEMA),
    });
    report.files.flatMap(describeDrift).forEach((line) => io.stdout(line));
    return report.ok ? 0 : 1;
  }

  // The values only reach .env, but an explicit flag is checked either way.
  if (options.local || Object.keys(flags).length) {
    const { errors } = validateValues(SCHEMA, values);
    if (errors.length) {
      errors.forEach((error) =>
        io.stderr(`configure-env: ${error.key}: ${error.message}`),
      );
      return 1;
    }
  }
  const paths = examplePaths(SCHEMA);
  if (options.local) paths.push(...localPaths(SCHEMA));
  const plan = await planRun({ schema: SCHEMA, root, paths, values });
  if (plan.errors.length) {
    plan.errors.forEach((error) =>
      io.stderr(
        `configure-env: ${error.kind === 'file' ? error.path : error.key}: ${error.message}`,
      ),
    );
    return 1;
  }
  const results = await applyPlan(plan);
  plan.files.forEach((file, index) => {
    const result = results[index]!;
    if (result.ok) io.stdout(describeFile(file));
    else io.stderr(`configure-env: ${describeFailure(result)}`);
  });
  return results.every((result) => result.ok) ? 0 : 1;
}

const isEntryPoint = () => {
  try {
    const script = process.argv[1];
    return (
      Boolean(script) &&
      realpathSync(script!) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
};

if (isEntryPoint()) {
  main(process.argv.slice(2), {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    // A pnpm script runs in the package directory and sets INIT_CWD to where
    // the command was typed; run directly, the process cwd is that place.
    cwd: process.env.INIT_CWD || process.cwd(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`configure-env: ${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
