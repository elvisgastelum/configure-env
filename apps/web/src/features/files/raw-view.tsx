import type { FileInfo } from '@configure-env/api-client';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { cn } from '@configure-env/design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fileContentQuery } from '../../lib/api';
import { type TokenKind, tokenize } from './dotenv-tokens';

const TOKEN_STYLE: Record<TokenKind, string> = {
  comment: 'text-muted-foreground italic',
  keyword: 'text-violet-600 dark:text-violet-400',
  key: 'font-semibold text-sky-700 dark:text-sky-300',
  operator: 'text-muted-foreground',
  value: 'text-emerald-700 dark:text-emerald-300',
  text: '',
};

/**
 * The file as it is on disk, read-only: numbered lines with the syntax
 * highlighted, secret values masked by the API, and the lines that do not
 * parse marked.
 */
export function RawView({ file }: { file: FileInfo }) {
  const { t } = useTranslation();
  const content = useQuery(fileContentQuery(file.path));
  const invalid = new Set(file.parseErrors.map(({ line }) => line));

  if (content.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('files.detail.rawError', { message: content.error.message })}
      </p>
    );
  if (!content.data)
    return (
      <div role="status" aria-label={t('files.detail.rawLoading')}>
        <Skeleton className="h-40" />
      </div>
    );
  if (!content.data.exists)
    return (
      <p className="text-sm text-muted-foreground">
        {t('files.detail.rawMissing', { path: file.path })}
      </p>
    );
  if (content.data.lines.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t('files.detail.rawEmpty')}
      </p>
    );

  return (
    <section
      aria-label={t('files.detail.rawLabel', { path: file.path })}
      className="flex flex-col gap-2"
    >
      <p className="text-xs text-muted-foreground">
        {t('files.detail.rawNote')}
      </p>
      <pre
        tabIndex={0}
        className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-5"
      >
        <code className="grid">
          {content.data.lines.map((line, index) => {
            const number = index + 1;
            const bad = invalid.has(number);
            return (
              <span
                key={number}
                className={cn(
                  'grid grid-cols-[3rem_1fr]',
                  bad && 'bg-destructive/10',
                )}
              >
                <span
                  aria-hidden="true"
                  className="pr-3 text-right text-muted-foreground tabular-nums select-none"
                >
                  {number}
                </span>
                <span
                  data-line={number}
                  data-invalid={bad || undefined}
                  title={
                    bad
                      ? t('files.detail.badLine', { line: number })
                      : undefined
                  }
                  className={cn(
                    'pr-3 whitespace-pre',
                    bad && 'underline decoration-destructive decoration-wavy',
                  )}
                >
                  {tokenize(line).map((token, at) => (
                    <span
                      key={at}
                      data-token={token.kind}
                      className={TOKEN_STYLE[token.kind]}
                    >
                      {token.text}
                    </span>
                  ))}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </section>
  );
}
