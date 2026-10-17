import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { CardSpotlight } from '@configure-env/design-system/motion/card-spotlight';
import { buttonVariants } from '@configure-env/design-system/components/atoms/button';
import { cn } from '@configure-env/design-system/utils';
import { Link } from '@tanstack/react-router';
import { ArrowRight, CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Check at a glance: passing or how many problems, a button
 * that runs it again, and a link to its full report.
 */
export function HealthCard({
  title,
  hint,
  to,
  runLabel,
  problems,
  problemsLabel,
  fetching,
  error,
  onRun,
}: {
  title: string;
  hint: string;
  to: '/check';
  runLabel: string;
  /** Undefined until the first answer. */
  problems: number | undefined;
  problemsLabel: (count: number) => string;
  fetching: boolean;
  error: string | undefined;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const passing = problems === 0;
  const Icon = passing ? CircleCheck : CircleAlert;

  return (
    <section aria-labelledby={titleId}>
      <Card className="relative isolate h-full px-4">
        <CardSpotlight />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="font-semibold tracking-tight">
              {title}
            </h3>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
          {problems === undefined ? (
            error ? null : (
              <Skeleton data-testid="overview-skeleton" className="h-5 w-16" />
            )
          ) : (
            <Badge
              variant={passing ? 'secondary' : 'destructive'}
              aria-live="polite"
            >
              <Icon aria-hidden="true" data-icon="inline-start" />
              {passing ? t('overview.health.passing') : problemsLabel(problems)}
            </Badge>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t('overview.health.failed', { message: error })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={fetching}
          >
            <RefreshCw
              aria-hidden="true"
              data-icon="inline-start"
              className={cn(fetching && 'animate-spin')}
            />
            {runLabel}
          </Button>
          <Link
            to={to}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {t('overview.health.report')}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </div>
      </Card>
    </section>
  );
}
