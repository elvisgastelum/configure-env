// `configure-env check`: reports drift and invalid values; writes nothing.

import { checkDrift } from '../engine/check.ts';
import {
  displayPath,
  contextOf,
  describeError,
  givenValue,
  loadContextSchema,
  parseCommand,
  parseSets,
} from './common.ts';
import { driftLines } from './format.ts';
import { CHECK_HELP } from './help.ts';
import type { Io } from './io.ts';
import { readState } from './protect.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  'use-env': { type: 'boolean' },
} as const;

export async function checkCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(CHECK_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  const sets = parseSets(options.set);
  // Deterministic by default: --set values only. With --use-env, as apply
  // --ci writes them: --set, else the environment.
  const values: Record<string, string> = { ...sets };
  if (options['use-env'])
    for (const key of Object.keys(schema.variables)) {
      const given = givenValue(key, sets, io.env);
      if (given !== undefined) values[key] = given;
    }

  const state = await readState(context, schema);
  const report = await checkDrift({
    schema,
    root: context.root,
    values,
    files: context.files,
    ...(state ? { state } : {}),
  });
  const code = report.ok ? 0 : 1;
  if (context.json) {
    io.stdout(JSON.stringify({ command: 'check', ...report }));
    return code;
  }

  const lines = report.files.flatMap(driftLines);
  const errors = report.errors.map(describeError);
  if (!context.ci && io.isTTY) {
    const { prompts, schemaPath } = context;
    prompts.intro(`configure-env check · ${displayPath(io.cwd, schemaPath)}`);
    if (lines.length) prompts.note(lines.join('\n'), 'Check');
    if (errors.length) prompts.log.error(errors.join('\n'));
    prompts.outro(
      report.ok
        ? 'Everything is current.'
        : 'Out of date: run configure-env apply to fix the drift.',
    );
    return code;
  }
  lines.forEach((line) => io.stdout(line));
  errors.forEach((error) => io.stderr(`configure-env: ${error}`));
  return code;
}
