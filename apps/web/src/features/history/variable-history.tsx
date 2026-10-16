import { buttonVariants } from '@configure-env/design-system/components/atoms/button';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HISTORY_LIMIT, historyQuery } from './history-api';
import { HistoryTimeline } from './history-timeline';

/**
 * One variable's history, in every file, newest first, with the same diffs
 * and undo as the History page, which opens filtered to it.
 */
export function VariableHistory({ name }: { name: string }) {
  const { t } = useTranslation();
  const history = useQuery(historyQuery({ key: name, limit: HISTORY_LIMIT }));
  return (
    <div className="flex flex-col gap-4">
      {history.error && (
        <p role="alert" className="text-sm text-destructive">
          {t('history.error', { message: history.error.message })}
        </p>
      )}
      {history.isPending && <Skeleton className="h-24 w-full rounded-lg" />}
      {history.data?.changes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('history.drawer.empty', { name })}
        </p>
      )}
      {history.data && history.data.changes.length > 0 && (
        <HistoryTimeline
          changes={history.data.changes}
          label={t('history.list')}
        />
      )}
      <Link
        to="/history"
        search={{ key: name }}
        className={buttonVariants({
          variant: 'link',
          size: 'sm',
          className: 'self-start px-0',
        })}
      >
        {t('history.drawer.all', { name })}
      </Link>
    </div>
  );
}
