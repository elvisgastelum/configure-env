// `pnpm configure:env`: writes the env example files, interactively (a TUI)
// or unattended (--ci). See the README, "Env files".
import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type InteractiveContext, runInteractive } from './interactive.ts';
import {
  type Target,
  applyPlan,
  checkDrift,
  describeChange,
  planChanges,
} from './plan.ts';
import { validateValues } from './schema.ts';
import { DEFAULT_VALUES, type EnvValues, type ExampleKey } from './template.ts';

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
} as const satisfies Record<string, ExampleKey>;

export type ValueFlags = Partial<Record<keyof typeof VALUE_FLAGS, string>>;

const USAGE = `Usage: pnpm configure:env [--ci] [--check] [--local] [--root <dir>]
                          [--web-host <host>] [--web-port <port>]
                          [--contact-email <email>] [--contact-whatsapp <digits|off>]

Writes deploy/.env.production.example (always rewritten from the template)
and .env.example (gains only the keys it lacks).

  --ci          never prompt (also when CI=true); required without a TTY
  --check       change nothing; list the drift and exit 1 when out of date
  --local       --ci only: also create .env (mode 600) when it is missing
  --root <dir>  the directory holding the files (default: the repo root)
  --web-host, --web-port, --contact-email, --contact-whatsapp
                the .env values; each falls back to the environment variable
                of the same name (WEB_HOST, WEB_PORT, VITE_CONTACT_EMAIL,
                VITE_CONTACT_WHATSAPP), then to the default
  -h, --help    show this help

Exit codes: 0 ok, 1 drift or an invalid value, 2 usage error, 130 cancelled.`;

/** The repository root, three levels up from this file. */
const DEFAULT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Whether stdin and stdout are both terminals. */
  isTTY: boolean;
  /** What a relative --root resolves against. */
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

  const root = resolve(io.cwd, options.root ?? DEFAULT_ROOT);
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
    return (io.interactive ?? runInteractive)({ root, check, values });
  }

  if (check) {
    const { drift, lines } = await checkDrift(root);
    lines.forEach((line) => io.stdout(line));
    return drift ? 1 : 0;
  }

  // The values only reach .env, but an explicit flag is checked either way.
  if (options.local || Object.keys(flags).length) {
    const result = validateValues(values);
    if (!result.ok) {
      result.errors.forEach((error) => io.stderr(`configure-env: ${error}`));
      return 1;
    }
  }
  const targets: Target[] = ['production', 'example'];
  if (options.local) targets.push('local');
  const plan = await planChanges({ root, targets, values });
  await applyPlan(root, plan);
  plan.changes.forEach((change) => io.stdout(describeChange(change)));
  return 0;
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
    // pnpm runs the script in the package directory; INIT_CWD is where the
    // command was typed.
    cwd: process.env.INIT_CWD ?? process.cwd(),
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
