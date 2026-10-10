import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  spinner,
  text,
} from '@clack/prompts';
import { applyPlan } from './engine/apply.ts';
import { checkDrift } from './engine/check.ts';
import { fileKeys, planChanges } from './engine/plan.ts';
import type { EnvSchema, FileSpec } from './schema/definition.ts';
import { validateValue } from './schema/values.ts';
import {
  describeDrift,
  describeFailure,
  describeFile,
  examplePaths,
  planRun,
} from './run.ts';

export interface InteractiveContext {
  schema: EnvSchema;
  root: string;
  check: boolean;
  /** Starting values for the local file prompts (flags, env, defaults). */
  values: Readonly<Record<string, string>>;
}

const HINTS: Record<FileSpec['policy'], string> = {
  generate: 'rewritten from the schema',
  merge: 'appends the missing keys',
  'create-only': 'never overwritten',
};

function cancelled(): number {
  cancel('Cancelled; nothing was written.');
  return 130;
}

/** The TUI: pick files, fill in local values, review the plan, confirm, apply. */
export async function runInteractive({
  schema,
  root,
  check,
  values,
}: InteractiveContext): Promise<number> {
  intro('configure-env');

  if (check) {
    const report = await checkDrift({
      schema,
      root,
      files: examplePaths(schema),
    });
    note(report.files.flatMap(describeDrift).join('\n'), 'Check');
    outro(
      report.ok ? 'Current.' : 'Out of date: run without --check to fix it.',
    );
    return report.ok ? 0 : 1;
  }

  const picked = await multiselect<string>({
    message: 'Which files should be written?',
    options: schema.files.map((file) => ({
      value: file.path,
      label: file.path,
      hint: file.mode
        ? `${HINTS[file.policy]}; mode ${file.mode}`
        : HINTS[file.policy],
    })),
    initialValues: examplePaths(schema),
    required: true,
  });
  if (isCancel(picked)) return cancelled();
  let paths = picked;

  const chosen: Record<string, string> = { ...values };
  for (const file of schema.files) {
    if (file.policy !== 'create-only' || !paths.includes(file.path)) continue;
    const planned = await planChanges({
      schema,
      root,
      values: {},
      files: [file.path],
    });
    if (planned.files[0]?.action !== 'create') {
      log.info(`${file.path} exists; skipping it (it is never overwritten).`);
      paths = paths.filter((path) => path !== file.path);
      continue;
    }
    for (const key of fileKeys(schema, file)) {
      const spec = schema.variables[key]!;
      const answer = await text({
        message: spec.description ? `${key} (${spec.description})` : key,
        initialValue: chosen[key] ?? '',
        validate: (value) => {
          const result = validateValue(spec, value ?? '');
          return result.ok ? undefined : result.error;
        },
      });
      if (isCancel(answer)) return cancelled();
      chosen[key] = answer ?? '';
    }
  }
  if (!paths.length) {
    outro('Nothing to do.');
    return 0;
  }

  const plan = await planRun({ schema, root, paths, values: chosen });
  if (plan.errors.length) {
    log.error(
      plan.errors
        .map((e) => `${e.kind === 'file' ? e.path : e.key}: ${e.message}`)
        .join('\n'),
    );
    outro('Nothing was written.');
    return 1;
  }
  note(plan.files.map(describeFile).join('\n'), 'Planned changes');
  if (
    plan.files.every(
      (file) => file.action !== 'create' && file.action !== 'update',
    )
  ) {
    outro('Everything is current.');
    return 0;
  }

  const go = await confirm({ message: 'Write these changes?' });
  if (isCancel(go)) return cancelled();
  if (!go) {
    outro('Nothing was written.');
    return 0;
  }

  const progress = spinner();
  progress.start('Writing');
  const failed = (await applyPlan(plan)).filter((result) => !result.ok);
  if (failed.length) {
    progress.error(`Failed: ${failed.map(describeFailure).join('; ')}`);
    return 1;
  }
  progress.stop('Written');
  outro('Done.');
  return 0;
}
