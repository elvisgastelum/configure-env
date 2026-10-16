import type { Change } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@configure-env/design-system/components/atoms/dialog';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { cn } from '@configure-env/design-system/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiffView } from '../schema/diff-view';
import { undoChanges, undoFailure } from './history-api';

const DATE = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** A side of a value change as the history shows it: secrets stay masked. */
const shown = (value: string | null, preview: string | null) =>
  value ?? preview;

/**
 * One change of the history: who made it, when, what it changed (a diff,
 * secrets masked), and its undo, or why it can't be undone.
 */
export function HistoryEntry({ change }: { change: Change }) {
  const { t } = useTranslation();
  const titleId = useId();
  const schema = change.operation === 'schema';
  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={titleId} className="font-medium break-words">
            <span className="sr-only">
              {t('history.entry.label', { id: change.id })}:{' '}
            </span>
            {schema ? (
              <>
                {t('history.operations.schema')}{' '}
                <code className="font-mono text-sm">{change.file}</code>
              </>
            ) : (
              <code className="font-mono text-sm">
                {t('history.entry.value', {
                  key: change.key,
                  file: change.file,
                })}
              </code>
            )}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">
              {t(`history.actors.${change.actor}`)}
            </Badge>
            {!schema && (
              <Badge variant="secondary">
                {t(`history.operations.${change.operation}`)}
              </Badge>
            )}
            <time dateTime={change.at}>{DATE.format(new Date(change.at))}</time>
            {change.undoOf !== null && (
              <span>{t('history.entry.undoOf', { id: change.undoOf })}</span>
            )}
          </div>
        </div>
        <UndoButton change={change} />
      </header>
      {schema ? <SchemaDiff change={change} /> : <ValueDiff change={change} />}
    </article>
  );
}

/** A value before and after; a secret's previews are masks. */
function ValueDiff({ change }: { change: Change }) {
  const { t } = useTranslation();
  const side = (
    label: string,
    value: string | null,
    preview: string | null,
    tone: string,
  ) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {shown(value, preview) === null ? (
          <span className="text-muted-foreground italic">
            {t('history.entry.notSet')}
          </span>
        ) : (
          <code
            className={cn(
              'rounded px-1 py-0.5 font-mono text-xs break-all',
              tone,
            )}
          >
            {shown(value, preview)}
          </code>
        )}
      </dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {side(
          t('history.entry.before'),
          change.beforeValue,
          change.beforePreview,
          'bg-destructive/10',
        )}
        {side(
          t('history.entry.after'),
          change.afterValue,
          change.afterPreview,
          'bg-primary/10',
        )}
      </dl>
      {change.secret && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          {t('history.entry.secret')}
        </p>
      )}
    </div>
  );
}

/** The schema's text before and after, behind a disclosure. */
function SchemaDiff({ change }: { change: Change }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {change.beforePreview ?? t('history.entry.notSet')} →{' '}
        {change.afterPreview}
      </p>
      <details>
        <summary className="cursor-pointer text-sm">
          {t('history.entry.showDiff')}
        </summary>
        <div className="mt-2">
          <DiffView
            before={change.beforeValue ?? ''}
            after={change.afterValue ?? ''}
            label={t('history.entry.diff', { file: change.file })}
          />
        </div>
      </details>
    </div>
  );
}

/**
 * Undo, after a confirmation; a change that can't be undone says why
 * instead. A refusal (the file changed since, say) stays in the dialog.
 */
function UndoButton({ change }: { change: Change }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const undo = useMutation({
    mutationFn: () => undoChanges(queryClient, [change.id]),
    onSuccess: () => {
      setOpen(false);
      toast.success(t('history.undo.done'));
    },
  });

  if (!change.restorable)
    return (
      <p className="flex max-w-xs items-start gap-1.5 text-xs text-muted-foreground">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t('history.undo.blocked', { reason: change.undoBlocker })}
      </p>
    );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('history.undo.label', { id: change.id })}
        onClick={() => {
          undo.reset();
          setOpen(true);
        }}
      >
        <Undo2 aria-hidden="true" data-icon="inline-start" />
        {t('history.undo.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('history.undo.title')}</DialogTitle>
            <DialogDescription>
              {change.operation === 'schema'
                ? t('history.undo.schemaBody', { file: change.file })
                : t('history.undo.valueBody', {
                    key: change.key,
                    file: change.file,
                  })}
            </DialogDescription>
          </DialogHeader>
          {undo.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('history.undo.failed', { message: undoFailure(undo.error) })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('history.undo.cancel')}
            </Button>
            <Button
              disabled={undo.isPending || undo.isError}
              aria-busy={undo.isPending || undefined}
              onClick={() => undo.mutate()}
            >
              {t('history.undo.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
