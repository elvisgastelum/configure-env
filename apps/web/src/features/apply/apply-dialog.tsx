import {
  type Applied,
  type Plan,
  type PlanConflict,
  type Variable,
  applyPlan,
  planChanges,
} from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@configure-env/design-system/components/atoms/dialog';
import { Spinner } from '@configure-env/design-system/components/atoms/spinner';
import type { SchemaDocument } from '@configure-env/core/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiRequestError,
  filesQuery,
  schemaQuery,
  unwrap,
  variablesQuery,
} from '../../lib/api';
import { ApplyResult } from './apply-result';
import { initialValue, neededKeys } from './needed';
import { writes } from './plan-model';
import { PlanPreview } from './plan-preview';
import { ValuesStep } from './values-step';

type Step = 'values' | 'preview' | 'confirm' | 'result';

/**
 * `configure-env apply` in the portal: the needed values, the plan with its
 * diffs, a confirmation, then the result per file. Every file, or `files`;
 * with `prune`, the keys the schema does not declare are removed too.
 */
export function ApplyDialog({
  open,
  onOpenChange,
  files,
  prune = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only these schema files; every file when absent. */
  files?: string[];
  /** Remove the keys the schema does not declare, as `apply --prune`. */
  prune?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('apply.close')}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        {open && (
          <ApplyFlow
            files={files}
            prune={prune}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The plan in a 409 or 422 answer: the plan as it is now. */
function conflictPlan(error: unknown): Plan | undefined {
  if (!(error instanceof ApiRequestError)) return;
  if (error.status !== 409 && error.status !== 422) return;
  return (error.body as Partial<PlanConflict> | undefined)?.plan;
}

function ApplyFlow({
  files,
  prune,
  onClose,
}: {
  files?: string[];
  prune: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const variables = useQuery(variablesQuery);
  const fileInfo = useQuery(filesQuery);
  const schema = useQuery(schemaQuery);
  const first = useQuery({
    queryKey: ['apply', 'first-plan', files ?? null, prune],
    queryFn: ({ signal }) =>
      unwrap(
        planChanges(
          { ...(files ? { files } : {}), ...(prune ? { prune } : {}) },
          { signal },
        ),
      ),
    gcTime: 0,
  });

  const [step, setStep] = useState<Step>('values');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [replaceKeys, setReplaceKeys] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan>();
  const [notice, setNotice] = useState<string>();
  const [result, setResult] = useState<Applied>();

  // A key the schema sets literally is not asked for: wait for the schema.
  const needed = useMemo(() => {
    if (!first.data || !variables.data || !fileInfo.data || !schema.data)
      return undefined;
    const keys = neededKeys(
      first.data,
      variables.data.variables,
      fileInfo.data.files,
      (schema.data.document ?? undefined) as SchemaDocument | undefined,
    );
    return variables.data.variables.filter((variable) =>
      keys.includes(variable.name),
    );
  }, [first.data, variables.data, fileInfo.data, schema.data]);

  const valueOf = (variable: Variable) =>
    answers[variable.name] ?? initialValue(variable);
  const values = Object.fromEntries(
    (needed ?? [])
      .map((variable) => [variable.name, valueOf(variable)] as const)
      .filter(([, value]) => value !== ''),
  );
  const inputs = (replace: readonly string[]) => ({
    ...(Object.keys(values).length ? { values } : {}),
    ...(files ? { files } : {}),
    ...(prune ? { prune } : {}),
    ...(replace.length ? { replaceProtected: [...replace] } : {}),
  });

  // Only the latest preview may show its plan: a late answer for earlier
  // inputs is dropped.
  const latestPreview = useRef(0);
  // Plans and runs carry values that may be secrets: keep none once done.
  const preview = useMutation({
    mutationFn: async (replace: readonly string[]) => {
      const request = ++latestPreview.current;
      const planned = await unwrap(planChanges(inputs(replace)));
      return { planned, latest: request === latestPreview.current };
    },
    gcTime: 0,
    onSuccess: ({ planned, latest }) => {
      if (!latest) return;
      setPlan(planned);
      setNotice(undefined);
      setStep('preview');
    },
  });
  const run = useMutation({
    mutationFn: (shown: Plan) =>
      unwrap(
        applyPlan({ ...inputs(replaceKeys), fingerprint: shown.fingerprint }),
      ),
    gcTime: 0,
    onMutate: () => setNotice(undefined),
    onSuccess: (applied) => {
      setResult(applied);
      setStep('result');
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      const now = conflictPlan(error);
      if (now) {
        setPlan(now);
        setNotice(
          error instanceof ApiRequestError && error.status === 409
            ? t('apply.plan.stale')
            : t('apply.plan.refused', { message: error.message }),
        );
      }
      setStep('preview');
    },
  });

  const problemsOf = (name: string) =>
    (plan?.errors ?? [])
      .filter((error) => error.key === name || error.keys?.includes(name))
      .map((error) => error.message);
  const writing = plan?.files.filter(writes) ?? [];
  const loadError =
    first.error ??
    variables.error ??
    fileInfo.error ??
    schema.error ??
    preview.error;
  const runError =
    run.error && !conflictPlan(run.error) ? run.error : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('apply.title')}</DialogTitle>
        <DialogDescription>
          {files
            ? t('apply.descriptionFiles', { files: files.join(', ') })
            : t('apply.description')}
        </DialogDescription>
      </DialogHeader>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {t('apply.failed', { message: loadError.message })}
        </p>
      )}

      {step === 'values' &&
        (needed ? (
          <ValuesStep
            variables={needed}
            valueOf={valueOf}
            onChange={(name, value) =>
              setAnswers((current) => ({ ...current, [name]: value }))
            }
            problemsOf={problemsOf}
          />
        ) : (
          !loadError && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t('apply.planning')}
            </p>
          )
        ))}

      {(step === 'preview' || step === 'confirm') && plan && (
        <>
          {notice && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {notice}
            </p>
          )}
          <PlanPreview
            plan={plan}
            replacing={replaceKeys.length > 0}
            onReplacingChange={(replacing) => {
              const keys = replacing
                ? [...new Set(plan.protected.map((refusal) => refusal.key))]
                : [];
              setReplaceKeys(keys);
              preview.mutate(keys);
            }}
          />
          {runError && (
            <p role="alert" className="text-sm text-destructive">
              {t('apply.failed', { message: runError.message })}
            </p>
          )}
        </>
      )}

      {step === 'confirm' && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
        >
          <p className="font-medium">
            {t('apply.confirm.title', { count: writing.length })}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {writing.map((file) => file.path).join(', ')}
          </p>
        </div>
      )}

      {step === 'result' && result && <ApplyResult result={result} />}

      <DialogFooter>
        {step === 'values' && (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('apply.cancel')}
            </Button>
            <Button
              disabled={!needed || preview.isPending}
              onClick={() => preview.mutate(replaceKeys)}
            >
              {preview.isPending && <Spinner />}
              {t('apply.values.preview')}
            </Button>
          </>
        )}
        {step === 'preview' && (
          <>
            {(needed?.length ?? 0) > 0 && (
              <Button variant="outline" onClick={() => setStep('values')}>
                {t('apply.plan.back')}
              </Button>
            )}
            <Button
              disabled={!plan?.ok || writing.length === 0 || preview.isPending}
              onClick={() => setStep('confirm')}
            >
              {t('apply.plan.apply')}
            </Button>
          </>
        )}
        {step === 'confirm' && plan && (
          <>
            <Button variant="outline" onClick={() => setStep('preview')}>
              {t('apply.confirm.back')}
            </Button>
            <Button disabled={run.isPending} onClick={() => run.mutate(plan)}>
              {run.isPending && <Spinner />}
              {t('apply.confirm.write')}
            </Button>
          </>
        )}
        {step === 'result' && (
          <Button onClick={onClose}>{t('apply.result.done')}</Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * Opens the apply flow: every file, or `files`. With `show` false the button
 * hides, but a dialog it opened stays until closed: applying a file can end
 * the very drift that showed the button, and the result must outlive it.
 */
export function ApplyButton({
  files,
  prune,
  label,
  variant = 'default',
  show = true,
}: {
  files?: string[];
  /** Remove the keys the schema does not declare, as `apply --prune`. */
  prune?: boolean;
  /** The button's text; Apply by default. */
  label?: string;
  variant?: 'default' | 'outline';
  show?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      {show && (
        <Button variant={variant} onClick={() => setOpen(true)}>
          {label ?? t('apply.open')}
        </Button>
      )}
      <ApplyDialog
        open={open}
        onOpenChange={setOpen}
        files={files}
        prune={prune}
      />
    </>
  );
}
