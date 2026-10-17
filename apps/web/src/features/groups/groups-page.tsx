import type { FileInfo, Group, Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { CardSpotlight } from '@configure-env/design-system/motion/card-spotlight';
import {
  RevealGroup,
  RevealItem,
} from '@configure-env/design-system/motion/reveal';
import { INTERACTIVE_CARD, TYPE } from '@configure-env/design-system/recipes';
import { cn } from '@configure-env/design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Layers } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  filesQuery,
  groupsQuery,
  schemaQuery,
  variablesQuery,
} from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { VariableLink } from '../check/variable-link';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import {
  VARIABLE_STATUSES,
  type VariableStatus,
  statusesOf,
} from '../variables/model';

/**
 * The variables by their group heading: a card per group with its counts,
 * the problems of its values and its members, each opening in the variables
 * browser. `?focus=<group>` (the palette's jump) marks its card.
 */
export function GroupsPage({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.groups')}</h1>
        <p className="text-pretty text-muted-foreground">{t('groups.lead')}</p>
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('groups.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && <GroupsSkeleton />}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} />
      )}
      {status === 'valid' && <GroupCards focus={focus} />}
    </div>
  );
}

function GroupCards({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  const groups = useQuery(groupsQuery);
  const variables = useQuery(variablesQuery);
  const files = useQuery(filesQuery);

  const error = groups.error ?? variables.error ?? files.error;
  if (error)
    return (
      <p role="alert" className="text-destructive">
        {t('groups.error', { message: error.message })}
      </p>
    );
  if (!groups.data || !variables.data || !files.data) return <GroupsSkeleton />;
  if (groups.data.groups.length === 0)
    return <p className="text-muted-foreground">{t('groups.empty')}</p>;

  const byName = new Map(
    variables.data.variables.map((variable) => [variable.name, variable]),
  );
  return (
    <RevealGroup as="ul" className="grid gap-3 md:grid-cols-2">
      {groups.data.groups.map((group) => (
        <RevealItem as="li" key={group.name ?? '\u0000ungrouped'}>
          <GroupCard
            group={group}
            members={group.variables.flatMap((name) => byName.get(name) ?? [])}
            files={files.data.files}
            focused={group.name !== null && group.name === focus}
          />
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/** How many of `members` have each problem in their values. */
function problemCounts(
  members: readonly Variable[],
  files: readonly FileInfo[],
): [VariableStatus, number][] {
  const counts = new Map<VariableStatus, number>();
  for (const variable of members)
    for (const status of statusesOf(variable, files))
      counts.set(status, (counts.get(status) ?? 0) + 1);
  return VARIABLE_STATUSES.flatMap((status) => {
    const count = counts.get(status);
    return count ? [[status, count] as [VariableStatus, number]] : [];
  });
}

const FLAGS = ['required', 'secret', 'protected'] as const;

function GroupCard({
  group,
  members,
  files,
  focused,
}: {
  group: Group;
  members: readonly Variable[];
  files: readonly FileInfo[];
  focused: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const title = group.name ?? t('groups.ungrouped');
  const problems = problemCounts(members, files);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  return (
    <article
      ref={ref}
      aria-labelledby={titleId}
      aria-current={focused || undefined}
      className="h-full"
    >
      <Card
        className={cn(
          'relative isolate h-full px-4',
          INTERACTIVE_CARD,
          focused && 'ring-2 ring-ring',
        )}
      >
        <CardSpotlight />
        <div className="flex flex-wrap items-start gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Layers aria-hidden="true" className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="truncate font-medium">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('groups.count', { count: group.variables.length })}
            </p>
          </div>
          <Link
            to="/variables"
            search={{ group: group.name }}
            aria-label={t('groups.view', { name: title })}
            className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            {t('groups.viewShort')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FLAGS.map((flag) =>
            group[flag] > 0 ? (
              <Badge key={flag} variant="secondary">
                {t(`groups.flags.${flag}`, { count: group[flag] })}
              </Badge>
            ) : null,
          )}
          {problems.map(([status, count]) => (
            <Badge
              key={status}
              variant={status === 'missing' ? 'outline' : 'destructive'}
            >
              {t(`groups.problems.${status}`, { count })}
            </Badge>
          ))}
          {problems.length === 0 && (
            <Badge variant="outline">{t('groups.allSet')}</Badge>
          )}
        </div>
        <ul
          aria-label={t('groups.members', { name: title })}
          className="flex flex-wrap gap-x-3 gap-y-1"
        >
          {group.variables.map((name) => (
            <li key={name}>
              <VariableLink name={name} />
            </li>
          ))}
        </ul>
      </Card>
    </article>
  );
}

function GroupsSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('groups.loading')}
      className="grid gap-3 md:grid-cols-2"
    >
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
    </div>
  );
}
