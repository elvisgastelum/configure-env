import type { FileInfo } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { CardSpotlight } from '@configure-env/design-system/motion/card-spotlight';
import { INTERACTIVE_CARD } from '@configure-env/design-system/recipes';
import { cn } from '@configure-env/design-system/utils';
import { ChevronDown, FileText } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { modeState } from './summary';

const DRIFT_VARIANT = {
  current: 'secondary',
  missing: 'outline',
  differs: 'destructive',
  'missing-keys': 'destructive',
  refused: 'destructive',
} as const;

/**
 * One env file: its policy, mode and drift, with the details (missing and
 * unknown keys, unparsable lines) in a panel that opens in place; the card
 * resizes with a layout animation. Given `onOpen` (the files page), it also
 * says whether the file exists and how many lines do not parse, and opens
 * the file's detail. `level` is the title's heading level: 3 under the
 * overview's section heading, 2 right under the files page's h1.
 */
export function FileCard({
  file,
  onOpen,
  level = 3,
}: {
  file: FileInfo;
  onOpen?: () => void;
  level?: 2 | 3;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelId = useId();
  const mode = modeState(file);
  const { drift } = file;
  const Title = `h${level}` as const;

  return (
    <motion.article
      layout
      aria-labelledby={titleId}
      className="h-full"
      transition={{ layout: { duration: 0.3 } }}
    >
      <Card className={cn('relative isolate h-full px-4', INTERACTIVE_CARD)}>
        <CardSpotlight />
        <motion.div
          layout="position"
          className="flex flex-wrap items-start gap-3"
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileText aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1 basis-40">
            <Title
              id={titleId}
              className="truncate font-mono text-sm font-medium"
            >
              {file.path}
            </Title>
            <dl className="mt-2 flex flex-wrap items-center gap-1.5">
              <dt className="sr-only">{t('overview.files.policy')}</dt>
              <dd>
                <Badge variant="outline">{file.policy}</Badge>
              </dd>
              {file.template && (
                <dd>
                  <Badge variant="outline">
                    {t('overview.files.template')}
                  </Badge>
                </dd>
              )}
              {mode.kind !== 'none' && (
                <>
                  <dt className="sr-only">{t('overview.files.mode')}</dt>
                  <dd>
                    <Badge
                      variant={
                        mode.kind === 'mismatch' ? 'destructive' : 'secondary'
                      }
                      className="font-mono"
                    >
                      {mode.kind === 'mismatch'
                        ? t('overview.files.modeMismatch', mode)
                        : mode.mode}
                    </Badge>
                  </dd>
                </>
              )}
              {onOpen && (
                <>
                  <dt className="sr-only">{t('overview.files.existence')}</dt>
                  <dd>
                    <Badge variant={file.exists ? 'secondary' : 'outline'}>
                      {file.exists
                        ? t('overview.files.exists')
                        : t('overview.files.absent')}
                    </Badge>
                  </dd>
                </>
              )}
              <dt className="sr-only">{t('overview.files.drift')}</dt>
              <dd>
                <Badge variant={DRIFT_VARIANT[drift.status]}>
                  {t(`overview.drift.${drift.status}`)}
                </Badge>
              </dd>
              {onOpen && file.parseErrors.length > 0 && (
                <>
                  <dt className="sr-only">{t('overview.files.parseErrors')}</dt>
                  <dd>
                    <Badge variant="destructive">
                      {t('overview.files.badLines', {
                        count: file.parseErrors.length,
                      })}
                    </Badge>
                  </dd>
                </>
              )}
            </dl>
          </div>
          {/* Wrapped below the name when the card is too narrow for both,
              so neither a long label nor a narrow card hides the name. */}
          <div className="ml-auto flex shrink-0 items-start gap-1">
            {onOpen && (
              <Button
                variant="outline"
                size="sm"
                aria-label={t('overview.files.openLabel', { path: file.path })}
                onClick={onOpen}
              >
                {t('overview.files.open')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((value) => !value)}
            >
              {t('overview.files.details')}
              <ChevronDown
                aria-hidden="true"
                data-icon="inline-end"
                className={cn(
                  'transition-transform duration-200',
                  open && 'rotate-180',
                )}
              />
            </Button>
          </div>
        </motion.div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <FileDetails file={file} level={level + 1} />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.article>
  );
}

function FileDetails({ file, level }: { file: FileInfo; level: number }) {
  const Heading = (level === 3 ? 'h3' : 'h4') as 'h3' | 'h4';
  const { t } = useTranslation();
  const { missingKeys, unknownKeys } = file.drift;
  const empty =
    missingKeys.length === 0 &&
    unknownKeys.length === 0 &&
    file.parseErrors.length === 0 &&
    !file.error;

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-3 text-sm">
      {empty && (
        <p className="text-muted-foreground">{t('overview.files.nothing')}</p>
      )}
      {file.error && (
        <p className="text-destructive">
          {t('overview.files.refused', { message: file.error })}
        </p>
      )}
      <KeyList
        title={t('overview.files.missingKeys')}
        keys={missingKeys}
        Heading={Heading}
      />
      <KeyList
        title={t('overview.files.unknownKeys')}
        keys={unknownKeys}
        Heading={Heading}
      />
      {file.parseErrors.length > 0 && (
        <div>
          <Heading className="text-xs font-medium text-muted-foreground">
            {t('overview.files.parseErrors')}
          </Heading>
          <ul className="mt-1 list-inside list-disc">
            {file.parseErrors.map(({ line, message }) => (
              <li key={line}>{t('overview.files.line', { line, message })}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KeyList({
  title,
  keys,
  Heading,
}: {
  title: string;
  keys: string[];
  Heading: 'h3' | 'h4';
}) {
  if (keys.length === 0) return null;
  return (
    <div>
      <Heading className="text-xs font-medium text-muted-foreground">
        {title}
      </Heading>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <li key={key}>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {key}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
