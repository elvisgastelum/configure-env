import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filesQuery, schemaQuery, variablesQuery } from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import {
  EMPTY_FILTERS,
  type Filters,
  type SortOrder,
  browse,
  groupsOf,
  hasUngrouped,
  typesOf,
} from './model';
import { RevealProvider, SecretValue } from './secret-value';
import { VariableDrawer } from './variable-drawer';
import { VariablesTable } from './variables-table';
import { VariablesToolbar } from './variables-toolbar';

/** Every variable: find it, understand it, and see its value per file. */
export function VariablesPage({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.variables')}</h1>
        <p className="text-pretty text-muted-foreground">
          {t('variables.lead')}
        </p>
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('variables.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && <BrowserSkeleton />}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} />
      )}
      {status === 'valid' && <VariablesBrowser focus={focus} />}
    </div>
  );
}

function VariablesBrowser({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  const variables = useQuery(variablesQuery);
  const files = useQuery(filesQuery);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortOrder>('schema');
  const [selected, setSelected] = useState<string | undefined>(focus);
  const [opened, setOpened] = useState<string | undefined>(focus);
  const [lastFocus, setLastFocus] = useState(focus);
  const searchRef = useRef<HTMLInputElement>(null);

  // A new palette jump selects its variable.
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus) {
      setSelected(focus);
      setOpened(focus);
    }
  }

  const list = useMemo(() => variables.data?.variables ?? [], [variables.data]);
  const fileList = useMemo(() => files.data?.files ?? [], [files.data]);
  const known = useMemo(
    () => new Set(list.map((variable) => variable.name)),
    [list],
  );
  const open = (name: string) => {
    setSelected(name);
    setOpened(name);
  };
  const sections = useMemo(
    () => browse(list, fileList, filters, sort),
    [list, fileList, filters, sort],
  );
  const shown = sections.reduce(
    (count, section) => count + section.variables.length,
    0,
  );

  if (variables.error)
    return (
      <p role="alert" className="text-destructive">
        {t('variables.error', { message: variables.error.message })}
      </p>
    );
  if (!variables.data || !files.data) return <BrowserSkeleton />;

  const valueFile = filters.file ?? fileList[0]?.path;

  return (
    <RevealProvider>
      <div className="flex flex-col gap-3">
        <VariablesToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          types={typesOf(list)}
          groups={groupsOf(list)}
          hasUngrouped={hasUngrouped(list)}
          files={fileList.map((file) => file.path)}
          searchRef={searchRef}
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {shown === list.length
            ? t('variables.count', { count: list.length })
            : t('variables.countFiltered', { shown, total: list.length })}
        </p>
        <VariablesTable
          sections={sections}
          files={fileList}
          valueFile={valueFile}
          statusFile={filters.file}
          selected={selected}
          onSelect={setSelected}
          onOpen={open}
          renderValue={(variable, file) => (
            <SecretValue variable={variable} file={file} />
          )}
          empty={
            list.length === 0
              ? t('variables.emptySchema')
              : t('variables.empty')
          }
        />
        <VariableDrawer
          variable={list.find((variable) => variable.name === opened)}
          files={fileList}
          known={known}
          onNavigate={open}
          onClose={() => setOpened(undefined)}
        />
      </div>
    </RevealProvider>
  );
}

function BrowserSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('variables.loading')}
      className="flex flex-col gap-3"
    >
      <Skeleton className="h-8" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-80" />
    </div>
  );
}
