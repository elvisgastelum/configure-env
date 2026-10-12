import type { Schema } from '@configure-env/api-client';
import { buttonVariants } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@configure-env/design-system/components/atoms/empty';
import { CodeBlock } from '@configure-env/design-system/components/molecules/code-block';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ExternalLink, FileWarning, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const INIT_COMMAND = 'npx configure-env init';
export const INIT_DOCS_URL =
  'https://github.com/elvisgastelum/configure-env#init';

/** The project has no schema yet: how to create one. */
export function NoSchema({ schema }: { schema: Schema }) {
  const { t } = useTranslation();
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

/** The schema exists but is not valid: its errors, with their paths. */
export function InvalidSchema({ schema }: { schema: Schema }) {
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
          >
            <code className="font-mono text-xs text-muted-foreground">
              {error.path}
            </code>
            <span>{error.message}</span>
          </li>
        ))}
      </ul>
      <Link
        to="/schema"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('overview.invalidSchema.open')}
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Card>
  );
}
