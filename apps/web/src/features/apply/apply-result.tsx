import type { Applied } from '@configure-env/api-client';
import { cn } from '@configure-env/design-system/utils';
import { CircleAlert, CircleCheck, CircleMinus } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

/** How long each file waits after the one before it appears. */
const STAGGER_S = 0.08;

/**
 * What the run did, file by file, each appearing after the one before; the
 * count of files written is announced. Without motion, all show at once.
 */
export function ApplyResult({ result }: { result: Applied }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const written = result.files.filter((file) => file.written).length;

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        className={cn(
          'text-sm font-medium',
          result.ok ? 'text-foreground' : 'text-destructive',
        )}
      >
        {result.ok
          ? t('apply.result.written', { count: written })
          : `${t('apply.result.written', { count: written })} ${t('apply.result.failed')}`}
      </p>
      <ul aria-label={t('apply.result.list')} className="flex flex-col gap-2">
        {result.files.map((file, index) => {
          const Icon = !file.ok
            ? CircleAlert
            : file.written
              ? CircleCheck
              : CircleMinus;
          return (
            <motion.li
              key={file.path}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduce ? { duration: 0 } : { delay: index * STAGGER_S }
              }
              className="flex items-start gap-3 rounded-lg border px-3 py-2"
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  !file.ok
                    ? 'text-destructive'
                    : file.written
                      ? 'text-primary'
                      : 'text-muted-foreground',
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm">{file.path}</span>
                  <span className="text-xs text-muted-foreground">
                    {file.ok
                      ? t(`apply.result.action.${file.action}`)
                      : t('apply.result.notWritten')}
                  </span>
                </span>
                {file.error && (
                  <span className="text-xs text-destructive">{file.error}</span>
                )}
              </span>
            </motion.li>
          );
        })}
      </ul>
      {result.replaced.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {result.replaced.map((entry) => (
            <li key={`${entry.file}:${entry.key}`}>
              {t('apply.result.replaced', entry)}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">{t('apply.result.warnings')}</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
