import { type Schema, initSchema } from '@configure-env/api-client';
import {
  Button,
  buttonVariants,
} from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@configure-env/design-system/components/atoms/empty';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { CodeBlock } from '@configure-env/design-system/components/molecules/code-block';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  ExternalLink,
  FileWarning,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  checkQuery,
  filesQuery,
  groupsQuery,
  schemaQuery,
  unwrap,
  validateQuery,
  variablesQuery,
} from '../../lib/api';
import { editorItem } from '../editor/editor';
import { OpenInEditorButton } from '../editor/open-in-editor';

export const INIT_COMMAND = 'npx configure-env init';
export const INIT_DOCS_URL =
  'https://github.com/elvisgastelum/configure-env#init';
/** The example env file init reads, as `configure-env init` does. */
export const INIT_EXAMPLE = '.env.example';

/**
 * Writes the schema `configure-env init` would, from .env.example (empty
 * without one), and shows it: the overview then reads the new schema.
 */
function useInitSchema() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(initSchema({})),
    onSuccess: async (written) => {
      queryClient.setQueryData(schemaQuery.queryKey, written);
      const variables = (written.document as { variables?: object } | null)
        ?.variables;
      toast.success(
        t('overview.noSchema.initDone', {
          path: written.path,
          count: Object.keys(variables ?? {}).length,
        }),
      );
      written.warnings?.forEach((warning) => toast.warning(warning));
      await Promise.all(
        [
          variablesQuery,
          groupsQuery,
          filesQuery,
          checkQuery,
          validateQuery,
        ].map((query) =>
          queryClient.invalidateQueries({ queryKey: query.queryKey }),
        ),
      );
    },
    onError: (error) => {
      toast.error(
        t('overview.noSchema.initFailed', { message: error.message }),
      );
      void queryClient.invalidateQueries({ queryKey: schemaQuery.queryKey });
    },
  });
}

/** The project has no schema yet: init it here, or with the CLI. */
export function NoSchema({ schema }: { schema: Schema }) {
  const { t } = useTranslation();
  const init = useInitSchema();
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-base">{t('overview.noSchema.title')}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {t('overview.noSchema.description', { path: schema.path })}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="w-full max-w-md">
        <div className="flex flex-col items-center gap-2">
          <Button
            onClick={() => init.mutate()}
            disabled={init.isPending}
            aria-busy={init.isPending}
          >
            <WandSparkles aria-hidden="true" data-icon="inline-start" />
            {schema.initFrom
              ? t('overview.noSchema.init', { file: schema.initFrom })
              : t('overview.noSchema.initEmpty')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {schema.initFrom
              ? t('overview.noSchema.initHint', {
                  file: schema.initFrom,
                  path: schema.path,
                })
              : t('overview.noSchema.initEmptyHint', {
                  file: INIT_EXAMPLE,
                  path: schema.path,
                })}
          </p>
        </div>
        <CodeBlock
          code={INIT_COMMAND}
          title={t('overview.noSchema.command')}
          language="sh"
          copyLabel={t('overview.noSchema.copy')}
          copiedLabel={t('overview.noSchema.copied')}
          className="w-full text-left"
        />
        <a
          href={INIT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'link' })}
        >
          {t('overview.noSchema.docs')}
          <ExternalLink aria-hidden="true" data-icon="inline-end" />
        </a>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The schema exists but is not valid: its errors, with their paths, and a
 * link to the schema page unless `link` is false (on that page).
 */
export function InvalidSchema({
  schema,
  link = true,
}: {
  schema: Schema;
  link?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="px-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <FileWarning aria-hidden="true" className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold tracking-tight">
            {t('overview.invalidSchema.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('overview.invalidSchema.description', { path: schema.path })}
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {schema.errors.map((error) => (
          <li
            key={`${error.path}:${error.message}`}
            className="flex flex-wrap items-baseline gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm"
            {...editorItem}
          >
            <code className="font-mono text-xs text-muted-foreground">
              {error.path}
            </code>
            <span className="min-w-0 flex-1">{error.message}</span>
            <OpenInEditorButton
              target={
                error.line === undefined
                  ? { file: schema.path, path: error.path }
                  : {
                      file: schema.path,
                      line: error.line,
                      ...(error.column === undefined
                        ? {}
                        : { column: error.column }),
                    }
              }
            />
          </li>
        ))}
      </ul>
      {link && (
        <Link
          to="/schema"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('overview.invalidSchema.open')}
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      )}
    </Card>
  );
}
