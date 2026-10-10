import { access } from 'node:fs/promises';
import { join } from 'node:path';
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
import {
  EXAMPLE_PATH,
  LOCAL_PATH,
  PRODUCTION_EXAMPLE_PATH,
  type Target,
  applyPlan,
  checkDrift,
  describeChange,
  planChanges,
} from './plan.ts';
import {
  contactEmail,
  contactWhatsapp,
  promptValidator,
  webHost,
  webPort,
} from './schema.ts';
import { EXAMPLE_KEYS, type EnvValues, type ExampleKey } from './template.ts';

export interface InteractiveContext {
  root: string;
  check: boolean;
  /** Starting values for the local .env prompts (flags, env, defaults). */
  values: EnvValues;
}

const PROMPTS: Record<
  ExampleKey,
  { message: string; schema: Parameters<typeof promptValidator>[0] }
> = {
  WEB_HOST: { message: 'WEB_HOST (address to publish on)', schema: webHost },
  WEB_PORT: { message: 'WEB_PORT (host port)', schema: webPort },
  VITE_CONTACT_EMAIL: {
    message: 'VITE_CONTACT_EMAIL (empty keeps the default)',
    schema: contactEmail,
  },
  VITE_CONTACT_WHATSAPP: {
    message: 'VITE_CONTACT_WHATSAPP (digits, `off`, or empty for the default)',
    schema: contactWhatsapp,
  },
};

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

function cancelled(): number {
  cancel('Cancelled; nothing was written.');
  return 130;
}

/** The TUI: pick targets, fill in .env, review the plan, confirm, apply. */
export async function runInteractive({
  root,
  check,
  values,
}: InteractiveContext): Promise<number> {
  intro('configure-env');

  if (check) {
    const { drift, lines } = await checkDrift(root);
    note(lines.join('\n'), 'Check');
    outro(drift ? 'Out of date: run without --check to fix it.' : 'Current.');
    return drift ? 1 : 0;
  }

  const picked = await multiselect<Target>({
    message: 'Which files should be written?',
    options: [
      {
        value: 'production',
        label: PRODUCTION_EXAMPLE_PATH,
        hint: 'rewritten from the template',
      },
      {
        value: 'example',
        label: `${EXAMPLE_PATH} keys`,
        hint: 'appends the missing keys',
      },
      {
        value: 'local',
        label: `local ${LOCAL_PATH}`,
        hint: 'mode 600; never overwritten',
      },
    ],
    initialValues: ['production', 'example'],
    required: true,
  });
  if (isCancel(picked)) return cancelled();
  let targets = picked;

  const chosen = { ...values };
  if (targets.includes('local')) {
    if (await exists(join(root, LOCAL_PATH))) {
      log.info(`${LOCAL_PATH} exists; skipping it (it is never overwritten).`);
      targets = targets.filter((target) => target !== 'local');
    } else {
      for (const key of EXAMPLE_KEYS) {
        const { message, schema } = PROMPTS[key];
        const answer = await text({
          message,
          initialValue: chosen[key],
          validate: promptValidator(schema),
        });
        if (isCancel(answer)) return cancelled();
        chosen[key] = answer ?? '';
      }
    }
  }
  if (!targets.length) {
    outro('Nothing to do.');
    return 0;
  }

  const plan = await planChanges({ root, targets, values: chosen });
  note(plan.changes.map(describeChange).join('\n'), 'Planned changes');
  if (plan.changes.every((change) => change.content === undefined)) {
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
  try {
    await applyPlan(root, plan);
  } catch (error) {
    progress.error(`Failed: ${(error as Error).message}`);
    return 1;
  }
  progress.stop('Written');
  outro('Done.');
  return 0;
}
