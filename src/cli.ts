#!/usr/bin/env node
// The configure-env entry point: runs `main` on the process. See
// `configure-env --help` and the README, "Usage".

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './cli/main.ts';

export { main } from './cli/main.ts';
export type { Io, Prompts } from './cli/io.ts';

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
