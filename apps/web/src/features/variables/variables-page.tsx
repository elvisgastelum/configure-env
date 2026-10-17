import { Kbd } from '@configure-env/design-system/components/atoms/kbd';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filesQuery, schemaQuery, variablesQuery } from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import { OpenInEditorButton } from '../editor/open-in-editor';
import {
  EMPTY_FILTERS,
  type Filters,
  type SortOrder,
  browse,
  groupsOf,
  hasUngrouped,
  typesOf,
} from './model';
import { variableText } from './copy';
import { CopyDotenvButton, CopyMenu } from './copy-menu';
import { RevealProvider, SecretValue } from './secret-value';
import { VariableDrawer } from './variable-drawer';
import { VariablesTable } from './variables-table';
import { useCopy } from './use-copy';
import { useShortcuts } from './use-shortcuts';
import { VariablesToolbar } from './variables-toolbar';

/** Every variable: find it, understand it, and see its value per file. */
export function VariablesPage({
  focus,
  group,
}: {
  focus?: string;
  /** The group to filter to first; null for the ungrouped variables. */
  group?: string | null;
}) {
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
      {status === 'valid' && <VariablesBrowser focus={focus} group={group} />}
    </div>
  );
}

function VariablesBrowser({
  focus,
  group,
}: {
  focus?: string;
  group?: string | null;
}) {
  const { t } = useTranslation();
  const variables = useQuery(variablesQuery);
  const files = useQuery(filesQuery);
  const [filters, setFilters] = useState<Filters>(() =>
    group === undefined ? EMPTY_FILTERS : { ...EMPTY_FILTERS, group },
  );
  const [sort, setSort] = useState<SortOrder>('schema');
  const [selected, setSelected] = useState<string | undefined>(focus);
  const [opened, setOpened] = useState<string | undefined>(focus);
  // The value being edited: a file of the opened variable.
  const [editing, setEditing] = useState<string>();
  const [lastFocus, setLastFocus] = useState(focus);
  const [lastGroup, setLastGroup] = useState(group);
  const searchRef = useRef<HTMLInputElement>(null);

  // A new palette jump selects its variable.
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus) {
      setSelected(focus);
      setOpened(focus);
      setEditing(undefined);
    }
  }

  // A new group in the address filters to it; none clears the filters, so
  // they never disagree with the address after back or forward.
  if (group !== lastGroup) {
    setLastGroup(group);
    setFilters(
      group === undefined ? EMPTY_FILTERS : { ...EMPTY_FILTERS, group },
    );
  }

  const list = useMemo(() => variables.data?.variables ?? [], [variables.data]);
  const fileList = useMemo(() => files.data?.files ?? [], [files.data]);
  const open = (name: string, editFile?: string) => {
    setSelected(name);
    setOpened(name);
    setEditing(editFile);
  };
  const sections = useMemo(
    () => browse(list, fileList, filters, sort),
    [list, fileList, filters, sort],
  );
  const shown = sections.reduce(
    (count, section) => count + section.variables.length,
    0,
  );
  const valueFile = filters.file ?? fileList[0]?.path;
  const valueExists = fileList.some(
    (file) => file.path === valueFile && file.exists,
  );
  const copy = useCopy();

  useShortcuts({
    search: () => searchRef.current?.focus(),
    move: (delta) => {
      const names = sections.flatMap((section) =>
        section.variables.map((variable) => variable.name),
      );
      if (names.length === 0) return;
      const index = selected === undefined ? -1 : names.indexOf(selected);
      const next =
        index === -1
          ? delta === 1
            ? 0
            : names.length - 1
          : Math.min(Math.max(index + delta, 0), names.length - 1);
      setSelected(names[next]);
    },
    copy: () => {
      const variable = list.find((entry) => entry.name === selected);
      if (!variable || !valueFile) return;
      void copy(async () => ({
        text: await variableText(variable, valueFile, 'value'),
        message: t('variables.copy.copied.value', { name: variable.name }),
      }));
    },
    edit: () => {
      if (selected && valueFile) open(selected, valueFile);
    },
  });

  if (variables.error)
    return (
      <p role="alert" className="text-destructive">
        {t('variables.error', { message: variables.error.message })}
      </p>
    );
  if (!variables.data || !files.data) return <BrowserSkeleton />;

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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p aria-live="polite">
            {shown === list.length
              ? t('variables.count', { count: list.length })
              : t('variables.countFiltered', { shown, total: list.length })}
          </p>
          <ShortcutHints />
        </div>
        <VariablesTable
          sections={sections}
          files={fileList}
          valueFile={valueFile}
          statusFile={filters.file}
          selected={selected}
          onSelect={setSelected}
          onOpen={(name) => open(name)}
          renderValue={(variable, file) => (
            <SecretValue variable={variable} file={file} />
          )}
          renderActions={(variable) =>
            valueFile &&
            variable.files.some((entry) => entry.file === valueFile) && (
              <span className="inline-flex items-center gap-0.5">
                {valueExists && (
                  <OpenInEditorButton
                    target={{ file: valueFile, key: variable.name }}
                  />
                )}
                <CopyMenu
                  variable={variable}
                  file={valueFile}
                  label={t('variables.copy.menu', { name: variable.name })}
                />
              </span>
            )
          }
          renderGroupActions={(group) => {
            if (!valueFile) return null;
            const members = list.filter(
              (variable) =>
                (variable.spec.group ?? null) === group &&
                variable.files.some((entry) => entry.file === valueFile),
            );
            const name = group ?? t('variables.filters.ungrouped');
            return (
              members.length > 0 && (
                <CopyDotenvButton
                  variables={members}
                  file={valueFile}
                  label={t('variables.copy.group', {
                    group: name,
                    file: valueFile,
                  })}
                  done={(count) =>
                    t('variables.copy.copied.group', { count, group: name })
                  }
                />
              )
            );
          }}
          empty={
            list.length === 0
              ? t('variables.emptySchema')
              : t('variables.empty')
          }
        />
        <VariableDrawer
          variable={list.find((variable) => variable.name === opened)}
          files={fileList}
          all={list}
          editing={editing}
          onEditingChange={setEditing}
          onNavigate={(name) => open(name)}
          onClose={() => {
            setOpened(undefined);
            setEditing(undefined);
          }}
        />
      </div>
    </RevealProvider>
  );
}

/** The page's single-key shortcuts, in one quiet line. */
function ShortcutHints() {
  const { t } = useTranslation();
  const hints = [
    [['/'], t('variables.shortcuts.search')],
    [['j', 'k'], t('variables.shortcuts.move')],
    [['c'], t('variables.shortcuts.copy')],
    [['e'], t('variables.shortcuts.edit')],
  ] as const;
  return (
    <p
      role="note"
      aria-label={t('variables.shortcuts.label')}
      className="hidden items-center gap-1.5 text-xs md:flex"
    >
      {hints.map(([keys, label], index) => (
        <span key={label} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden="true">·</span>}
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          {label}
        </span>
      ))}
    </p>
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
