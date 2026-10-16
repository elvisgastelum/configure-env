import type {
  FileValidation,
  Validate,
  Variable,
} from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { TYPE } from '@configure-env/design-system/recipes';
import { cn } from '@configure-env/design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  filesQuery,
  schemaQuery,
  validateQuery,
  variablesQuery,
} from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { VariableLink } from '../check/variable-link';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import { RevealProvider } from '../variables/secret-value';
import { ValueEditor } from '../variables/value-editor';
import { editorItem } from '../editor/editor';
import { OpenInEditorButton } from '../editor/open-in-editor';
import { groupProblems, othersOf } from './problem-groups';

/** The value being fixed: a key in a file. */
interface Editing {
  file: string;
  key: string;
}

/**
 * `configure-env validate` in the portal: the value and rule errors grouped
 * by file and variable, each variable fixed in place.
 */
export function ValidatePage() {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.validate')}</h1>
        <p className="text-pretty text-muted-foreground">
          {t('validate.lead')}
        </p>
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('validate.error', { message: schema.error.message })}
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
  const validate = useQuery(validateQuery);
  const variables = useQuery(variablesQuery);
  // A value write names the fingerprint of the file it was read from.
  useQuery(filesQuery);
  const [editing, setEditing] = useState<Editing>();

  return (
    <RevealProvider>
      <div>
        <Button
          variant="outline"
          aria-busy={validate.isFetching || undefined}
          onClick={() => void validate.refetch()}
        >
          <RefreshCw
            aria-hidden="true"
            data-icon="inline-start"
            className={cn(validate.isFetching && 'motion-safe:animate-spin')}
          />
          {t('validate.run')}
        </Button>
      </div>
      {validate.error && (
        <p role="alert" className="text-destructive">
          {t('validate.error', { message: validate.error.message })}
        </p>
      )}
      {!validate.data && !validate.error && <ReportSkeleton />}
      {validate.data && (
        <ReportBody
          report={validate.data}
          variables={variables.data?.variables ?? []}
          editing={editing}
          onEditingChange={setEditing}
        />
      )}
    </RevealProvider>
  );
}

function ReportBody({
  report,
  variables,
  editing,
  onEditingChange,
}: {
  report: Validate;
  variables: readonly Variable[];
  editing?: Editing;
  onEditingChange: (editing?: Editing) => void;
}) {
  const { t } = useTranslation();
  const errors = report.files.reduce(
    (sum, file) => sum + file.errors.length,
    0,
  );
  const failing = report.files.filter((file) => file.errors.length > 0).length;
  return (
    <>
      <p role="status" className="text-sm font-medium">
        {report.ok || errors === 0
          ? t('validate.passing')
          : `${t('validate.errorCount', { count: errors })} ${t('validate.inFiles', { count: failing })}`}
      </p>
      <ul className="flex flex-col gap-3">
        {report.files.map((file) => (
          <li key={file.path}>
            <FileReport
              file={file}
              variables={variables}
              editing={editing?.file === file.path ? editing.key : undefined}
              onEdit={(key) =>
                onEditingChange(key ? { file: file.path, key } : undefined)
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
  file: FileValidation;
  variables: readonly Variable[];
  editing?: string;
  onEdit: (key?: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const groups = groupProblems(file.errors);
  return (
    <Card className="gap-3 px-4">
      <section aria-labelledby={titleId} className="flex flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="font-mono text-sm font-medium">
            {file.path}
          </h2>
          {file.template && (
            <Badge variant="outline">{t('overview.files.template')}</Badge>
          )}
          {file.errors.length > 0 ? (
            <Badge variant="destructive">
              {t('validate.errorCount', { count: file.errors.length })}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('validate.noErrors')}
            </span>
          )}
        </header>
        {groups.variables.map(({ name, problems }) => {
          const variable = variables.find(
            (entry) =>
              entry.name === name &&
              entry.files.some((value) => value.file === file.path),
          );
          return (
            <Group
              key={name}
              title={<VariableLink name={name} />}
              action={
                <>
                  {variable && editing !== name && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => onEdit(name)}
                    >
                      <span aria-hidden="true">{t('validate.fix')}</span>
                      <span className="sr-only">
                        {t('validate.fixLabel', { name, file: file.path })}
                      </span>
                    </Button>
                  )}
                  {file.exists && (
                    <OpenInEditorButton
                      target={{ file: file.path, key: name }}
                    />
                  )}
                </>
              }
            >
              <ul className="flex flex-col gap-1">
                {problems.map((problem, index) => {
                  const others = othersOf(problem, name);
                  return (
                    <li key={index} className="flex flex-wrap gap-x-2">
                      <span data-message="">
                        {problem.message}
                        {problem.reason && ` (${problem.reason})`}
                      </span>
                      {others.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t('validate.with')}{' '}
                          {others.map((other) => (
                            <VariableLink key={other} name={other} />
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {variable && editing === name && (
                <ValueEditor
                  variable={variable}
                  file={file.path}
                  onDone={() => onEdit(undefined)}
                />
              )}
            </Group>
          );
        })}
        {groups.lines.length > 0 && (
          <Group
            title={t('validate.lines')}
            action={
              <Link
                to="/files"
                search={{ focus: file.path }}
                className="text-xs underline-offset-4 hover:underline"
              >
                {t('validate.openFile', { path: file.path })}
              </Link>
            }
          >
            <ul className="flex flex-col gap-1">
              {groups.lines.map((problem, index) => (
                <li
                  key={index}
                  className="flex items-center gap-2"
                  {...editorItem}
                >
                  <span data-message="" className="min-w-0 flex-1">
                    {t('validate.line', {
                      line: problem.line,
                      message: problem.message,
                    })}
                  </span>
                  {file.exists && (
                    <OpenInEditorButton
                      target={{ file: file.path, line: problem.line }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}
        {groups.other.length > 0 && (
          <Group title={t('validate.file')}>
            <ul className="flex flex-col gap-1">
              {groups.other.map((problem, index) => (
                <li key={index} data-message="">
                  {problem.message}
                </li>
              ))}
            </ul>
          </Group>
        )}
        {file.warnings.length > 0 && (
          <Group title={t('validate.warnings')} muted>
            <ul className="flex flex-col gap-1">
              {file.warnings.map((problem, index) => (
                <li key={index} data-message="">
                  {[problem.key ?? problem.keys?.join(', '), problem.message]
                    .filter(Boolean)
                    .join(' ')}
                </li>
              ))}
            </ul>
          </Group>
        )}
      </section>
    </Card>
  );
}

/** One heading and its problems, inside a file's report. */
function Group({
  title,
  action,
  muted = false,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-2 rounded-lg px-3 py-2 text-sm',
        muted ? 'border border-dashed' : 'bg-muted/40',
      )}
      {...editorItem}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="min-w-0 flex-1 text-sm font-medium">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReportSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      aria-busy="true"
      aria-label={t('validate.loading')}
      className="flex flex-col gap-3"
    >
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
