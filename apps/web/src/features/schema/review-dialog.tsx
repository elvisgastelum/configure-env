import type { Schema, SchemaError } from '@configure-env/api-client';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@configure-env/design-system/components/atoms/tabs';
import { CodeBlock } from '@configure-env/design-system/components/molecules/code-block';
import { formatJson } from '@configure-env/core/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkQuery,
  filesQuery,
  schemaQuery,
  validateQuery,
  variablesQuery,
} from '../../lib/api';
import { DiffView } from './diff-view';
import {
  type SchemaEdit,
  previewEdit,
  refusedErrors,
  sendEdit,
  staleSchema,
  validDocument,
} from './edits';
import { editTitle } from './titles';

/** An edit waiting for review: what it changes, and who hears back. */
export interface ReviewRequest {
  /** New for every request, so a new review starts fresh. */
  id: number;
  edit: SchemaEdit;
  /** The API refused it (422): the errors, with their JSON paths. */
  onRefused?: (errors: SchemaError[]) => void;
  /** It was written. */
  onSaved?: (schema: Schema) => void;
}

/**
 * The review before a schema write: the diff of the schema now against the
 * schema the edit makes, and the raw JSON it makes, both from the core's
 * writer. Save sends the edit against the fingerprint of the schema shown;
 * when the schema changed meanwhile (409), the review rebases the edit on
 * the schema as it is now and asks again.
 */
export function ReviewDialog({
  request,
  onClose,
}: {
  request?: ReviewRequest;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-5xl">
        {request && (
          <ReviewBody key={request.id} request={request} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  request,
  onClose,
}: {
  request: ReviewRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: schema } = useQuery(schemaQuery);
  const [stale, setStale] = useState(false);
  const document = validDocument(schema);
  const before = useMemo(
    () => (document ? formatJson(document) : ''),
    [document],
  );
  const preview = useMemo(
    () => (document ? previewEdit(document, request.edit) : undefined),
    [document, request.edit],
  );
  const after =
    preview?.ok === true ? formatJson(preview.document, before) : undefined;
  const path = schema?.path ?? 'env.schema.json';

  const save = useMutation({
    mutationFn: () => sendEdit(request.edit, schema?.fingerprint ?? ''),
    onSuccess: async (written) => {
      queryClient.setQueryData(schemaQuery.queryKey, written);
      toast.success(t('schemaEditor.review.saved', { path }));
      request.onSaved?.(written);
      onClose();
      await Promise.all(
        [variablesQuery, filesQuery, checkQuery, validateQuery].map((query) =>
          queryClient.invalidateQueries({ queryKey: query.queryKey }),
        ),
      );
    },
    onError: (error) => {
      const now = staleSchema(error);
      if (now) {
        queryClient.setQueryData(schemaQuery.queryKey, now);
        setStale(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: schemaQuery.queryKey });
      const errors = refusedErrors(error);
      if (errors) {
        toast.error(t('schemaEditor.review.refused'));
        request.onRefused?.(errors);
        onClose();
      }
    },
  });

  const failure =
    save.error && !staleSchema(save.error) && !refusedErrors(save.error)
      ? save.error.message
      : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editTitle(t, request.edit)}</DialogTitle>
        <DialogDescription>
          {t('schemaEditor.review.description', { path })}
        </DialogDescription>
      </DialogHeader>
      {stale && (
        <p
          role="status"
          className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {t('schemaEditor.review.stale', { path })}
        </p>
      )}
      {preview && !preview.ok && (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="text-destructive">{t('schemaEditor.review.invalid')}</p>
          <ul className="flex flex-col gap-1">
            {preview.errors.map((error) => (
              <li
                key={`${error.path}:${error.message}`}
                className="flex flex-wrap items-baseline gap-2 rounded-lg bg-muted/60 px-3 py-1.5"
              >
                <code className="font-mono text-xs text-muted-foreground">
                  {error.path}
                </code>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {after !== undefined && (
        <Tabs defaultValue="changes" className="min-w-0">
          <TabsList aria-label={t('schemaEditor.review.tabs')}>
            <TabsTrigger value="changes">
              {t('schemaEditor.review.changes')}
            </TabsTrigger>
            <TabsTrigger value="raw">
              {t('schemaEditor.review.raw')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="changes" className="min-w-0">
            {after === before ? (
              <p className="text-sm text-muted-foreground">
                {t('schemaEditor.review.noChanges')}
              </p>
            ) : (
              <DiffView
                before={before}
                after={after}
                label={t('schemaEditor.review.diff', { path })}
              />
            )}
          </TabsContent>
          <TabsContent value="raw" className="min-w-0">
            <CodeBlock
              code={after}
              title={path}
              language="json"
              copyLabel={t('schemaEditor.review.copy')}
              copiedLabel={t('schemaEditor.review.copied')}
              className="max-h-[60vh] overflow-auto"
            />
          </TabsContent>
        </Tabs>
      )}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {t('schemaEditor.review.failed', { message: failure })}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('schemaEditor.review.cancel')}
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={after === undefined || after === before || save.isPending}
        >
          {save.isPending
            ? t('schemaEditor.review.saving')
            : t('schemaEditor.review.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
