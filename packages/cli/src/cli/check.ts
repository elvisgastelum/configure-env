// `configure-env check`: one report of every problem the env files have
// against the schema, by file, then what git could commit that it must not;
// writes nothing, unless it fixes those git-ignore problems (--fix, or the
// person picks them in a terminal). It runs through the configure-env API
// (connect.ts): GET /api/check, POST /api/check with --file or values, and
// POST /api/check/gitignore for the fixes.

import {
  fixGitignore,
  getCheck,
  runCheck,
} from '@configure-env/api-client/client';
import type {
  CheckReport,
  GitignoreFix,
  GitignoreProblem,
  SchemaError,
} from '@configure-env/core';
import {
  CliError,
  describeError,
  givenValue,
  parseCommand,
  parseSets,
} from './common.ts';
import {
  type Connection,
  type ProjectRun,
  answerMessage,
  openProject,
  send,
} from './connect.ts';
import {
  checkLines,
  checkSummary,
  gitignoreFixLine,
  gitignoreLine,
} from './format.ts';
import { CHECK_HELP } from './help.ts';
import type { Io } from './io.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  'use-env': { type: 'boolean' },
  strict: { type: 'boolean' },
  fix: { type: 'boolean' },
} as const;

/** What a check takes, as GET and POST /api/check take it. */
interface Inputs {
  strict: boolean;
  files?: string[];
  values: Record<string, string>;
}

/**
 * The body of an answer the check expects, else the error the CLI exits
 * with: an invalid schema (exit 1, with its errors), a state that cannot be
 * read, a .gitignore that cannot be written, or anything else the server
 * refused, by its message.
 */
function answer<T>(
  run: ProjectRun,
  response: { status: number; data: unknown },
): T {
  if (response.status === 200) return response.data as T;
  if (response.status === 422) {
    const { errors = [] } = response.data as { errors?: SchemaError[] };
    throw new CliError(1, [
      `invalid schema ${run.title}:`,
      ...errors.map((error) => `  ${error.path}: ${error.message}`),
    ]);
  }
  throw new CliError(1, [answerMessage(response)]);
}

/** The check report, through GET /api/check unless it takes files or values. */
async function check(
  run: ProjectRun,
  connection: Connection,
  { strict, files, values }: Inputs,
): Promise<CheckReport> {
  const response =
    files?.length || Object.keys(values).length
      ? await send(connection, () =>
          runCheck(
            { strict, ...(files ? { files } : {}), values },
            connection.init(),
          ),
        )
      : await send(connection, () =>
          getCheck(strict ? { strict: 'true' } : undefined, connection.init()),
        );
  return answer<CheckReport>(run, response);
}

/**
 * Fixes the git-ignore problems, by path, through POST /api/check/gitignore;
 * answers what it wrote and the check after. A .gitignore it cannot write
 * fails the run.
 */
async function fix(
  run: ProjectRun,
  connection: Connection,
  problems: readonly GitignoreProblem[],
  { strict, files, values }: Inputs,
): Promise<{ fixed: GitignoreFix[]; check?: CheckReport }> {
  if (!problems.length) return { fixed: [] };
  const response = await send(connection, () =>
    fixGitignore(
      {
        paths: problems.map((problem) => problem.path),
        strict,
        ...(files ? { files } : {}),
        ...(Object.keys(values).length ? { values } : {}),
      },
      connection.init(),
    ),
  );
  return answer<{ fixed: GitignoreFix[]; check: CheckReport }>(run, response);
}

/** Asks which git-ignore problems to fix, each selected first; none on cancel. */
async function pick(
  { prompts }: ProjectRun,
  problems: readonly GitignoreProblem[],
): Promise<GitignoreProblem[]> {
  const fixable = problems.filter((problem) => !problem.blocked);
  if (!fixable.length) return [];
  const chosen = await prompts.multiselect({
    message: 'Fix these git-ignore problems?',
    options: fixable.map((problem, index) => ({
      value: index,
      label: problem.path,
      hint: `add ${problem.entries.join(', ')} to ${problem.gitignore}`,
    })),
    initialValues: fixable.map((_, index) => index),
    required: false,
  });
  if (prompts.isCancel(chosen)) return [];
  return chosen.map((index) => fixable[index]!);
}

const reportLines = (report: CheckReport) => [
  ...report.files.flatMap(checkLines),
  ...report.gitignore.map(gitignoreLine),
];

export async function checkCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, OPTIONS);
  if (options.help) {
    io.stdout(CHECK_HELP);
    return 0;
  }
  const run = await openProject(io, options);
  const { schema } = run;
  const sets = parseSets(options.set);
  // Deterministic by default: --set values only. With --use-env, as apply
  // --ci writes them: --set, else the environment.
  const values: Record<string, string> = { ...sets };
  if (options['use-env'])
    for (const key of Object.keys(schema.variables)) {
      const given = givenValue(key, sets, io.env);
      if (given !== undefined) values[key] = given;
    }
  const inputs: Inputs = {
    strict: Boolean(options.strict),
    ...(run.files ? { files: run.files } : {}),
    values,
  };

  const connection = await run.connect();
  try {
    return await report(io, run, connection, inputs, Boolean(options.fix));
  } finally {
    await connection.close();
  }
}

/** Runs the check, its fixes, and prints them; resolves to the exit code. */
async function report(
  io: Io,
  run: ProjectRun,
  connection: Connection,
  inputs: Inputs,
  fixAll: boolean,
): Promise<number> {
  let report = await check(run, connection, inputs);
  // --fix writes first, so the report is what remains.
  let fixed: GitignoreFix[] = [];
  if (fixAll) {
    const done = await fix(run, connection, report.gitignore, inputs);
    fixed = done.fixed;
    if (fixed.length && done.check) report = done.check;
  }
  if (run.json) {
    io.stdout(JSON.stringify(fixAll ? { ...report, fixed } : report));
    return report.ok ? 0 : 1;
  }

  const errors = report.errors.map(describeError);
  if (!run.ci && io.isTTY) {
    const { prompts } = run;
    prompts.intro(`configure-env check · ${run.title}`);
    fixed.forEach((done) => prompts.log.success(gitignoreFixLine(done)));
    const lines = reportLines(report);
    if (lines.length) prompts.note(lines.join('\n'), 'Check');
    if (errors.length) prompts.log.error(errors.join('\n'));
    if (!fixAll) {
      const picked = await fix(
        run,
        connection,
        await pick(run, report.gitignore),
        inputs,
      );
      picked.fixed.forEach((done) =>
        prompts.log.success(gitignoreFixLine(done)),
      );
      if (picked.fixed.length && picked.check) report = picked.check;
    }
    const fixes = new Set(
      report.files.flatMap((file) =>
        file.problems.map((problem) => problem.fix),
      ),
    );
    const hint =
      fixes.has('apply') || fixes.has('prune')
        ? ` Run configure-env apply${fixes.has('prune') ? ' --prune' : ''} to fix the drift.`
        : '';
    const summary = checkSummary(report);
    prompts.outro(hint ? `${summary}.${hint}` : summary);
    return report.ok ? 0 : 1;
  }
  fixed.forEach((done) => io.stdout(gitignoreFixLine(done)));
  reportLines(report).forEach((line) => io.stdout(line));
  io.stdout(checkSummary(report));
  errors.forEach((error) => io.stderr(`configure-env: ${error}`));
  return report.ok ? 0 : 1;
}
