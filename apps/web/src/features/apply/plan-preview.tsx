import type { FilePlan, Plan } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Checkbox } from '@configure-env/design-system/components/atoms/checkbox';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { writes } from './plan-model';
import { UnifiedDiff } from './unified-diff';

const VARIANT = {
  create: 'default',
  update: 'default',
  mode: 'secondary',
  unchanged: 'outline',
  skip: 'outline',
} as const;

/**
 * What applying would do, file by file: the action, the keys it adds or
 * removes, the mode, why a file is skipped, and the unified diff; then the
 * errors and protected values that stop it.
 */
export function PlanPreview({
  plan,
  replacing,
  onReplacingChange,
}: {
  plan: Plan;
  /** Whether the plan replaces the protected values it lists. */
  replacing: boolean;
  onReplacingChange: (replacing: boolean) => void;
}) {
  const { t } = useTranslation();
  const replaceId = useId();
  const changing = plan.files.filter(writes).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {changing === 0
          ? t('apply.plan.nothing')
          : `${t('apply.plan.changes', { count: changing })}, ${t('apply.plan.same', { count: plan.files.length - changing })}.`}
      </p>
      {(plan.errors.length > 0 || plan.protected.length > 0) && (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="text-destructive">{t('apply.plan.errors')}</p>
          <ul className="flex flex-col gap-1">
            {plan.errors.map((error, index) => (
              <li
                key={`error-${index}`}
                className="rounded-lg bg-muted/60 px-3 py-1.5"
              >
                {t('apply.plan.error', {
                  subject:
                    error.key ?? error.keys?.join(', ') ?? error.path ?? '',
                  message: error.message,
                })}
              </li>
            ))}
            {plan.protected.map((refusal) => (
              <li
                key={`${refusal.file}:${refusal.key}`}
                className="rounded-lg bg-muted/60 px-3 py-1.5"
              >
                {refusal.reason
                  ? t('apply.plan.protectedReason', { ...refusal })
                  : t('apply.plan.protected', { ...refusal })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(plan.protected.length > 0 || replacing) && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-labelledby={replaceId}
            checked={replacing}
            onCheckedChange={(checked) => onReplacingChange(checked === true)}
          />
          <span id={replaceId}>{t('apply.plan.replace')}</span>
        </label>
      )}
      <ul className="flex flex-col gap-3">
        {plan.files.map((file) => (
          <li key={file.path}>
            <FilePlanView file={file} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilePlanView({ file }: { file: FilePlan }) {
  const { t } = useTranslation();
  const titleId = useId();
  const showDiff =
    file.diff.length > 0 &&
    file.action !== 'unchanged' &&
    file.action !== 'skip';
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="font-mono text-sm font-medium">
          {file.path}
        </h3>
        <Badge variant={VARIANT[file.action]}>
          {t(`apply.plan.action.${file.action}`)}
        </Badge>
        <Badge variant="outline">{file.policy}</Badge>
      </header>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {file.addedKeys.length > 0 && (
          <li>{t('apply.plan.adds', { keys: file.addedKeys.join(', ') })}</li>
        )}
        {file.prunedKeys.length > 0 && (
          <li>
            {t('apply.plan.prunes', { keys: file.prunedKeys.join(', ') })}
          </li>
        )}
        {file.currentMode !== null &&
          file.currentMode !== file.mode &&
          file.action !== 'skip' && (
            <li>
              {t('apply.plan.mode', { from: file.currentMode, to: file.mode })}
            </li>
          )}
        {file.action === 'skip' && file.reason && (
          <li>
            {t(`apply.plan.reason.${file.reason}`, {
              error: file.error ?? '',
            })}
          </li>
        )}
      </ul>
      {showDiff && (
        <UnifiedDiff
          lines={file.diff}
          label={t('apply.plan.diff', { path: file.path })}
        />
      )}
    </section>
  );
}
