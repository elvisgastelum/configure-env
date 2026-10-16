import type { Check, FileDrift, Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { TYPE } from '@configure-env/design-system/recipes';
import { cn } from '@configure-env/design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkQuery,
  filesQuery,
  schemaQuery,
  variablesQuery,
} from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { ApplyButton } from '../apply/apply-dialog';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import { RevealProvider } from '../variables/secret-value';
import { ValueEditor } from '../variables/value-editor';
import { editorItem } from '../editor/editor';
import { OpenInEditorButton } from '../editor/open-in-editor';
import {
  type DriftItem,
  applyFixes,
  driftItems,
  editorTargetOf,
  keyOf,
} from './drift-items';
import { VariableLink } from './variable-link';

const DRIFT_VARIANT = {
  current: 'secondary',
  missing: 'outline',
  differs: 'destructive',
  'missing-keys': 'destructive',
  refused: 'destructive',
} as const;

/** The item whose value is being set: one item of one file. */
interface Editing {
  file: string;
  /** The item's id in the file's list (`itemId`). */
  item: string;
}

/** An item's id in its file's list; two items may name the same key. */
const itemId = (item: DriftItem, index: number) => `${item.kind}-${index}`;

/**
 * `configure-env check` in the portal: the drift report grouped by file,
 * each item linking to its variable with a fix, setting the value or
 * applying the file.
 */
export function CheckPage() {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.check')}</h1>
        <p className="text-pretty text-muted-foreground">{t('check.lead')}</p>
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('check.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && <ReportSkeleton />}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} />
      )}
      {status === 'valid' && <Report />}
    </div>
  );
}

function Report() {
  const { t } = useTranslation();
  const check = useQuery(checkQuery);
  const variables = useQuery(variablesQuery);
  // A value write names the fingerprint of the file it was read from.
  useQuery(filesQuery);
  const [editing, setEditing] = useState<Editing>();
  const list = variables.data?.variables ?? [];

  return (
    <RevealProvider>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-busy={check.isFetching || undefined}
          onClick={() => void check.refetch()}
        >
          <RefreshCw
            aria-hidden="true"
            data-icon="inline-start"
            className={cn(check.isFetching && 'motion-safe:animate-spin')}
          />
          {t('check.run')}
        </Button>
        <ApplyButton variant="outline" label={t('check.applyAll')} />
      </div>
      {check.error && (
        <p role="alert" className="text-destructive">
          {t('check.error', { message: check.error.message })}
        </p>
      )}
      {variables.error && (
        <p role="alert" className="text-destructive">
          {t('check.valuesError', { message: variables.error.message })}
        </p>
      )}
      {!check.data && !check.error && <ReportSkeleton />}
      {check.data && (
        <ReportBody
          check={check.data}
          variables={list}
          editing={editing}
          onEditingChange={setEditing}
        />
      )}
    </RevealProvider>
  );
}

function ReportBody({
  check,
  variables,
  editing,
  onEditingChange,
}: {
  check: Check;
  variables: readonly Variable[];
  editing?: Editing;
  onEditingChange: (editing?: Editing) => void;
}) {
  const { t } = useTranslation();
  const errorsId = useId();
  const drifting = check.files.filter(
    (file) => driftItems(file).length > 0,
  ).length;
  return (
    <>
      <p role="status" className="text-sm font-medium">
        {check.ok
          ? t('check.passing')
          : drifting > 0
            ? t('check.summary', { count: drifting })
            : t('check.summaryErrors')}
      </p>
      {check.errors.length > 0 && (
        <section aria-labelledby={errorsId} className="flex flex-col gap-2">
          <h2 id={errorsId} className={TYPE.cardTitle}>
            {t('check.valueErrors')}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {check.errors.map((error, index) => {
              const keys = error.key ? [error.key] : (error.keys ?? []);
              return (
                <li
                  key={index}
                  className="flex flex-wrap items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5"
                >
                  <span>
                    {keys.map((key) => (
                      <span key={key}>
                        <VariableLink name={key} />{' '}
                      </span>
                    ))}
                    {!keys.length && error.path && (
                      <>
                        <code className="font-mono text-xs">
                          {error.path}
                        </code>{' '}
                      </>
                    )}
                    {error.message}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <ul className="flex flex-col gap-3">
        {check.files.map((file) => (
          <li key={file.path}>
            <FileReport
              file={file}
              variables={variables}
              editing={editing?.file === file.path ? editing.item : undefined}
              onEdit={(item) =>
                onEditingChange(item ? { file: file.path, item } : undefined)
              }
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function FileReport({
  file,
  variables,
  editing,
  onEdit,
}: {
  file: FileDrift;
  variables: readonly Variable[];
  /** The item whose value is being set in this file (`itemId`). */
  editing?: string;
  onEdit: (item?: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const items = driftItems(file);
  return (
    <Card className="gap-3 px-4">
      <section aria-labelledby={titleId} className="flex flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="font-mono text-sm font-medium">
            {file.path}
          </h2>
          <Badge variant={DRIFT_VARIANT[file.status]}>
            {t(`overview.drift.${file.status}`)}
          </Badge>
          <Badge variant="outline">{file.policy}</Badge>
          {applyFixes(file) && (
            <span className="ml-auto">
              <ApplyButton
                files={[file.path]}
                variant="outline"
                label={t('check.applyFile', { path: file.path })}
              />
            </span>
          )}
        </header>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('check.nothing')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {items.map((item, index) => {
              const key = keyOf(item);
              const variable = key
                ? variables.find((entry) => entry.name === key)
                : undefined;
              const id = itemId(item, index);
              const open = variable !== undefined && editing === id;
              const target = editorTargetOf(file, item);
              return (
                <li
                  key={id}
                  className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2"
                  {...editorItem}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span data-message="" className="min-w-0 flex-1">
                      <ItemMessage item={item} />
                    </span>
                    {variable && !open && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => onEdit(id)}
                      >
                        <span aria-hidden="true">{t('check.set')}</span>
                        <span className="sr-only">
                          {t('check.setLabel', {
                            name: variable.name,
                            file: file.path,
                          })}
                        </span>
                      </Button>
                    )}
                    {item.kind === 'line' && (
                      <Link
                        to="/files"
                        search={{ focus: file.path }}
                        className="text-xs underline-offset-4 hover:underline"
                      >
                        {t('check.openFile', { path: file.path })}
                      </Link>
                    )}
                    {target && <OpenInEditorButton target={target} />}
                  </div>
                  {open && variable && (
                    <ValueEditor
                      variable={variable}
                      file={file.path}
                      onDone={() => onEdit(undefined)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}

/** What an item says, its variable's name a link to it. */
function ItemMessage({ item }: { item: DriftItem }) {
  const { t } = useTranslation();
  switch (item.kind) {
    case 'absent':
      return <>{t('check.item.absent')}</>;
    case 'differs':
      return <>{t('check.item.differs')}</>;
    case 'refused':
      return <>{t('check.item.refused', { message: item.message })}</>;
    case 'missing':
      return (
        <>
          <VariableLink name={item.key} /> {t('check.item.missing')}
        </>
      );
    case 'invalid':
      return (
        <>
          <VariableLink name={item.key} /> {item.message}
          {item.shown !== '' && (
            <>
              : <code className="font-mono text-xs">{item.shown}</code>
            </>
          )}
        </>
      );
    case 'rule':
      return (
        <>
          <VariableLink name={item.key} /> {item.message}
        </>
      );
    case 'protected':
      return (
        <>
          <VariableLink name={item.key} /> {item.message}
          {item.reason && ` (${item.reason})`}
        </>
      );
    case 'unknown':
      return (
        <>
          <code className="font-mono text-xs">{item.key}</code>{' '}
          {t('check.item.unknown')}
        </>
      );
    case 'mode':
      return <>{t('check.item.mode', item)}</>;
    case 'line':
      return <>{t('check.item.line', { line: item.line })}</>;
  }
}

function ReportSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      aria-busy="true"
      aria-label={t('check.loading')}
      className="flex flex-col gap-3"
    >
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
