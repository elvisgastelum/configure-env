import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@configure-env/design-system/components/atoms/empty';
import { Input } from '@configure-env/design-system/components/atoms/input';
import { Label } from '@configure-env/design-system/components/atoms/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@configure-env/design-system/components/atoms/select';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { filesQuery, schemaQuery } from '../../lib/api';
import { HISTORY_LIMIT, historyQuery } from './history-api';
import type { HistoryActor, HistorySearch } from './history-search';
import { HistoryTimeline } from './history-timeline';

/** Base UI selects need a value for "any": this one never names a choice. */
const ANY = '\u0000any';

interface Option {
  value: string;
  label: string;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="sm" className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The history of edits: every change to the env files and the schema, from
 * the portal or the CLI, as a timeline with a diff each, filtered by file,
 * variable, who made it and date, one page at a time.
 */
export function HistoryPage({
  search,
  onSearchChange,
}: {
  search: HistorySearch;
  onSearchChange: (search: HistorySearch) => void;
}) {
  const { t } = useTranslation();
  const page = search.page ?? 1;
  const filters: HistorySearch = { ...search };
  delete filters.page;
  const history = useQuery(
    historyQuery({ ...filters, page, limit: HISTORY_LIMIT }),
  );
  const filtered = Object.keys(filters).length > 0;
  /** A new filter starts at the first page. */
  const filter = (changes: Partial<HistorySearch>) =>
    onSearchChange({ ...filters, ...changes, page: undefined });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.history')}</h1>
        <p className="text-pretty text-muted-foreground">{t('history.lead')}</p>
      </header>
      <Filters search={search} filtered={filtered} onChange={filter} />
      {history.error && (
        <p role="alert" className="text-destructive">
          {t('history.error', { message: history.error.message })}
        </p>
      )}
      {history.isPending && <TimelineSkeleton />}
      {history.data && history.data.changes.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{t('history.empty.title')}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? t('history.empty.filtered')
                : t('history.empty.description')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {history.data && history.data.changes.length > 0 && (
        <>
          <HistoryTimeline changes={history.data.changes} />
          <Pages
            page={page}
            limit={history.data.limit}
            total={history.data.total}
            shown={history.data.changes.length}
            onPage={(next) =>
              onSearchChange({
                ...filters,
                page: next > 1 ? next : undefined,
              })
            }
          />
        </>
      )}
    </div>
  );
}

function Filters({
  search,
  filtered,
  onChange,
}: {
  search: HistorySearch;
  filtered: boolean;
  onChange: (changes: Partial<HistorySearch>) => void;
}) {
  const { t } = useTranslation();
  const ids = { key: useId(), from: useId(), to: useId() };
  const files = useQuery(filesQuery);
  const schema = useQuery(schemaQuery);
  const paths = [
    ...new Set([
      ...(schema.data ? [schema.data.path] : []),
      ...(files.data?.files.map((file) => file.path) ?? []),
      ...(search.file ? [search.file] : []),
    ]),
  ];
  const fileOptions: Option[] = [
    { value: ANY, label: t('history.filters.anyFile') },
    ...paths.map((path) => ({ value: path, label: path })),
  ];
  const actorOptions: Option[] = [
    { value: ANY, label: t('history.filters.anyActor') },
    { value: 'portal', label: t('history.actors.portal') },
    { value: 'cli', label: t('history.actors.cli') },
  ];
  const orAny = (value: string) => (value === ANY ? undefined : value);

  return (
    <search
      aria-label={t('history.filters.label')}
      className="flex flex-wrap items-end gap-3"
    >
      <FilterSelect
        label={t('history.filters.file')}
        value={search.file ?? ANY}
        options={fileOptions}
        onChange={(value) => onChange({ file: orAny(value) })}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.key} className="text-xs text-muted-foreground">
          {t('history.filters.key')}
        </Label>
        <Input
          id={ids.key}
          className="h-8 w-44 font-mono"
          placeholder={t('history.filters.keyPlaceholder')}
          value={search.key ?? ''}
          onChange={(event) =>
            onChange({ key: event.target.value.trim() || undefined })
          }
        />
      </div>
      <FilterSelect
        label={t('history.filters.actor')}
        value={search.actor ?? ANY}
        options={actorOptions}
        onChange={(value) =>
          onChange({ actor: orAny(value) as HistoryActor | undefined })
        }
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.from} className="text-xs text-muted-foreground">
          {t('history.filters.from')}
        </Label>
        <Input
          id={ids.from}
          type="date"
          className="h-8 w-40"
          value={search.from ?? ''}
          onChange={(event) =>
            onChange({ from: event.target.value || undefined })
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.to} className="text-xs text-muted-foreground">
          {t('history.filters.to')}
        </Label>
        <Input
          id={ids.to}
          type="date"
          className="h-8 w-40"
          value={search.to ?? ''}
          onChange={(event) =>
            onChange({ to: event.target.value || undefined })
          }
        />
      </div>
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              file: undefined,
              key: undefined,
              actor: undefined,
              from: undefined,
              to: undefined,
            })
          }
        >
          {t('history.filters.clear')}
        </Button>
      )}
    </search>
  );
}

function Pages({
  page,
  limit,
  total,
  shown,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const first = (page - 1) * limit + 1;
  if (total <= limit && page === 1) return null;
  return (
    <nav
      aria-label={t('history.pages.label')}
      className="flex items-center justify-between gap-2"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('history.pages.newer')}
      </Button>
      <p className="text-sm text-muted-foreground tabular-nums">
        {t('history.pages.status', {
          from: first,
          to: first + shown - 1,
          total,
        })}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={first + shown - 1 >= total}
        onClick={() => onPage(page + 1)}
      >
        {t('history.pages.older')}
      </Button>
    </nav>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}
