// The environment picker in the header: local, or another environment
// `configure-env env add` stored, listed by GET /api/environments. The
// active one is always shown; prod stands apart in the destructive color,
// so a change there is never mistaken for a local one. Picking one sends
// every request through the serving server's gateway and refetches every
// view. It stays out of the way while serve has no other environment.
// While the shown environment does not answer, a notice beside it says so
// until its live updates come again.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@configure-env/design-system/components/atoms/select';
import { cn } from '@configure-env/design-system/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { environmentsQuery } from '../lib/api';
import {
  LOCAL,
  isProduction,
  isRemote,
  selectEnvironment,
  useEnvironment,
} from '../lib/environment';
import { useEventsUnreachable } from '../lib/use-project-events';

/** Switches to `name` and refetches every view but the list of environments. */
function useSwitchEnvironment() {
  const queryClient = useQueryClient();
  const [listKey] = environmentsQuery.queryKey;
  return (name: string) => {
    selectEnvironment(name);
    void queryClient.resetQueries({
      predicate: (query) => query.queryKey[0] !== listKey,
    });
  };
}

export function EnvironmentPicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current = useEnvironment();
  const switchTo = useSwitchEnvironment();
  const { data } = useQuery(environmentsQuery);
  const unreachable = useEventsUnreachable();
  const environments = data?.environments ?? [];

  // An environment removed since it was picked: back to local.
  const listed = environments.some(({ name }) => name === current);
  useEffect(() => {
    if (data && !listed && isRemote(current)) switchTo(LOCAL);
  });

  if (environments.length < 2 && !isRemote(current)) return null;
  const production = isProduction(current);
  const remote = isRemote(current);

  return (
    <>
      <Select
        value={current}
        onValueChange={(next) => {
          if (typeof next === 'string' && next !== current) switchTo(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={t('environment.label')}
          data-environment={current}
          data-production={production}
          data-reachable={unreachable === undefined}
          title={t('environment.label')}
          className={cn(
            'max-w-48 font-mono text-xs',
            remote && 'border-primary/60 bg-primary/10 dark:bg-primary/15',
            production &&
              'border-destructive bg-destructive/10 text-destructive dark:border-destructive dark:bg-destructive/20',
            className,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              production
                ? 'bg-destructive'
                : remote
                  ? 'bg-primary'
                  : 'bg-muted-foreground/50',
            )}
          />
          <span className="truncate">{current}</span>
          {production && (
            <span className="rounded-sm border border-current px-1 font-sans text-[0.625rem] leading-4 font-semibold tracking-wide uppercase">
              {t('environment.production')}
            </span>
          )}
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          align="end"
          className="min-w-64"
        >
          {environments.map((environment) => (
            <SelectItem
              key={environment.name}
              value={environment.name}
              disabled={!environment.reachable}
              title={
                environment.local
                  ? environment.url
                  : t('environment.remote', { url: environment.url })
              }
            >
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'font-mono text-xs',
                    isProduction(environment.name) &&
                      'font-semibold text-destructive',
                  )}
                >
                  {environment.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {environment.local
                    ? t('environment.local')
                    : environment.reachable
                      ? environment.url
                      : `${t('environment.unreachable')} · ${environment.url}`}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unreachable !== undefined && (
        <span
          role="status"
          title={unreachable}
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="size-2 animate-pulse rounded-full bg-amber-500"
          />
          {t('environment.retrying')}
        </span>
      )}
    </>
  );
}
