// `configure-env check`: one report of every problem the env files have
// against the schema, by file, then what git could commit that it must not;
// writes nothing, unless it fixes those git-ignore problems (--fix, or the
// person picks them in a terminal).

import {
  type CheckReport,
  type GitignoreFix,
  type GitignoreProblem,
  checkDrift,
  fixGitignore,
} from '@configure-env/core';
import {
  CliError,
  type Context,
  displayPath,
  contextOf,
  describeError,
  givenValue,
  loadContextSchema,
  parseCommand,
  parseSets,
} from './common.ts';
import {
  checkLines,
  checkSummary,
  gitignoreFixLine,
  gitignoreLine,
} from './format.ts';
import { CHECK_HELP } from './help.ts';
import type { Io } from './io.ts';
import { readState } from './protect.ts';

const OPTIONS = {
  set: { type: 'string', multiple: true },
  'use-env': { type: 'boolean' },
  strict: { type: 'boolean' },
  fix: { type: 'boolean' },
} as const;

/** fixGitignore, a .gitignore it cannot write failing the run. */
async function fix(
  root: string,
  problems: readonly GitignoreProblem[],
): Promise<GitignoreFix[]> {
  try {
    return (await fixGitignore(root, problems)).fixed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new CliError(1, [
      `cannot update .gitignore: ${code ?? (error as Error).message}`,
    ]);
  }
}

/** Asks which git-ignore problems to fix, each selected first; none on cancel. */
async function pick(
  { prompts }: Context,
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
  const check = () =>
    checkDrift({
      schema,
      root: context.root,
      values,
      files: context.files,
      strict: Boolean(options.strict),
      statePath: context.statePath,
      ...(state ? { state } : {}),
    });
  let report = await check();
  // --fix writes first, so the report is what remains.
  const fixed = options.fix ? await fix(context.root, report.gitignore) : [];
  if (fixed.length) report = await check();
  if (context.json) {
    io.stdout(JSON.stringify(options.fix ? { ...report, fixed } : report));
    return report.ok ? 0 : 1;
  }

  const errors = report.errors.map(describeError);
  if (!context.ci && io.isTTY) {
    const { prompts, schemaPath } = context;
    prompts.intro(`configure-env check · ${displayPath(io.cwd, schemaPath)}`);
    fixed.forEach((done) => prompts.log.success(gitignoreFixLine(done)));
    const lines = reportLines(report);
    if (lines.length) prompts.note(lines.join('\n'), 'Check');
    if (errors.length) prompts.log.error(errors.join('\n'));
    if (!options.fix) {
      const picked = await fix(
        context.root,
        await pick(context, report.gitignore),
      );
      picked.forEach((done) => prompts.log.success(gitignoreFixLine(done)));
      if (picked.length) report = await check();
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
