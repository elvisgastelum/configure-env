import type {
  Check,
  FileCheck,
  PlanError,
  Problem,
  ProblemSeverity,
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
import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react';
import { type MouseEvent, useId, useState } from 'react';
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
  applyFixes,
  countsOf,
  editorTargetOf,
  failingFiles,
  filterProblems,
  keysOf,
  pruneFixes,
  sortProblems,
} from './problems';
import { GitignoreReport } from './gitignore-report';
import { VariableLink } from './variable-link';

const STATUS_VARIANT = {
  current: 'secondary',
  missing: 'outline',
  differs: 'destructive',
  'missing-keys': 'destructive',
  refused: 'destructive',
} as const;

/** The codes a person fixes by setting the problem's key. */
const SET_CODES = new Set<Problem['code']>([
  'missing-key',
  'invalid-value',
  'rule',
  'protected',
]);

/** The problem whose value is being set: one problem of one file. */
interface Editing {
  file: string;
  /** The problem's id in its file (`problemId`). */
  problem: string;
}

/** A problem's id in its file, stable while the filter changes. */
const problemId = (problem: Problem, index: number) =>
  `${problem.code}-${index}`;

/** A file section's id, for the summary's links to it. */
const fileAnchor = (index: number) => `check-file-${index}`;

/**
 * `configure-env check` in the portal: one report of every problem, summed up
 * at the top, filtered by severity, and grouped by file in schema order; each
 * problem links to its variable with its fix, setting the value or applying
 * the file.
 */
export function CheckPage({
  severity,
  onSeverityChange,
}: {
  /** The problems to show; every one when undefined. */
  severity?: ProblemSeverity;
  onSeverityChange: (severity?: ProblemSeverity) => void;
}) {
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
      {status === 'valid' && (
        <Report severity={severity} onSeverityChange={onSeverityChange} />
      )}
    </div>
  );
}

function Report({
  severity,
  onSeverityChange,
}: {
  severity?: ProblemSeverity;
  onSeverityChange: (severity?: ProblemSeverity) => void;
}) {
  const { t } = useTranslation();
  const check = useQuery(checkQuery);
  const variables = useQuery(variablesQuery);
  // A value write names the fingerprint of the file it was read from.
  useQuery(filesQuery);
  const [editing, setEditing] = useState<Editing>();
  // What the last run found, said without moving the focus.
  const [announcement, setAnnouncement] = useState('');

  const run = async () => {
    setAnnouncement('');
    const { data } = await check.refetch();
    if (data)
      setAnnouncement(
        t('check.announce', {
          errors: t('check.errors', { count: data.summary.errors }),
          warnings: t('check.warnings', { count: data.summary.warnings }),
        }),
      );
  };

  return (
    <RevealProvider>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-busy={check.isFetching || undefined}
          onClick={() => void run()}
        >
          <RefreshCw
            aria-hidden="true"
            data-icon="inline-start"
            className={cn(check.isFetching && 'motion-safe:animate-spin')}
          />
          {t('check.run')}
        </Button>
        <ApplyButton variant="outline" label={t('check.applyAll')} />
        <p role="status" className="sr-only">
          {announcement}
        </p>
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
          variables={variables.data?.variables ?? []}
          severity={severity}
          onSeverityChange={onSeverityChange}
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
  severity,
  onSeverityChange,
  editing,
  onEditingChange,
}: {
  check: Check;
  variables: readonly Variable[];
  severity?: ProblemSeverity;
  onSeverityChange: (severity?: ProblemSeverity) => void;
  editing?: Editing;
  onEditingChange: (editing?: Editing) => void;
}) {
  const { t } = useTranslation();
  const { errors, warnings } = check.summary;
  // Under a filter, only the files with a problem of that severity show.
  const shown = check.files
    .map((file, index) => ({ file, index }))
    .filter(
      ({ file }) =>
        !severity || filterProblems(file.problems, severity).length > 0,
    );
  return (
    <>
      <Summary check={check} />
      {errors + warnings > 0 && (
        <SeverityFilter
          counts={{ all: errors + warnings, error: errors, warning: warnings }}
          severity={severity}
          onChange={onSeverityChange}
        />
      )}
      {shown.length === 0 && severity ? (
        <p className="text-sm text-muted-foreground">{t('check.noMatch')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map(({ file, index }) => (
            <li key={file.path}>
              <FileReport
                file={file}
                anchor={fileAnchor(index)}
                severity={severity}
                variables={variables}
                editing={
                  editing?.file === file.path ? editing.problem : undefined
                }
                onEdit={(problem) =>
                  onEditingChange(
                    problem ? { file: file.path, problem } : undefined,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <GitignoreReport
        problems={check.gitignore}
        hidden={severity === 'warning'}
      />
    </>
  );
}

/**
 * The report at a glance, as an error summary: the counts by severity, how
 * many files fail, a link to each failing file, and the plan's own errors.
 */
function Summary({ check }: { check: Check }) {
  const { t } = useTranslation();
  const titleId = useId();
  const jumpId = useId();
  const { errors, warnings, files, failing } = check.summary;
  const clean = errors + warnings === 0 && check.errors.length === 0;
  const failingList = failingFiles(check);
  // Moves the focus to the file's section, as a skip link does.
  const jump = (event: MouseEvent<HTMLAnchorElement>, anchor: string) => {
    const target = document.getElementById(anchor);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView?.({ block: 'start' });
    target.focus();
  };
  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-3 px-4">
        <h2 id={titleId} className="sr-only">
          {t('check.summary.title')}
        </h2>
        {clean ? (
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck
              aria-hidden="true"
              className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            {t('check.passing')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <SeverityCount severity="error" count={errors} />
            <SeverityCount severity="warning" count={warnings} />
            <span className="text-sm text-muted-foreground">
              {t('check.summary.failing', { failing, count: files })}
            </span>
          </div>
        )}
        {failingList.length > 0 && (
          <nav aria-labelledby={jumpId} className="flex flex-col gap-1.5">
            <h3 id={jumpId} className="text-sm font-medium">
              {t('check.summary.jump')}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {failingList.map((file) => {
                const anchor = fileAnchor(check.files.indexOf(file));
                const count = countsOf(file.problems).errors;
                return (
                  <li key={file.path}>
                    <a
                      href={`#${anchor}`}
                      onClick={(event) => jump(event, anchor)}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm underline-offset-4 hover:bg-muted hover:underline"
                    >
                      <span className="font-mono text-xs">{file.path}</span>{' '}
                      <span className="text-xs text-destructive">
                        {t('check.errors', { count })}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        {check.errors.length > 0 && <PlanErrors errors={check.errors} />}
      </Card>
    </section>
  );
}

/** A severity's icon and count, its word in the text: never color alone. */
function SeverityCount({
  severity,
  count,
}: {
  severity: ProblemSeverity;
  count: number;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1.5 font-medium">
      <SeverityIcon severity={severity} />
      {t(severity === 'error' ? 'check.errors' : 'check.warnings', { count })}
    </span>
  );
}

function SeverityIcon({
  severity,
  className,
}: {
  severity: ProblemSeverity;
  className?: string;
}) {
  const Icon = severity === 'error' ? CircleX : TriangleAlert;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        'size-4 shrink-0',
        severity === 'error'
          ? 'text-destructive'
          : 'text-amber-600 dark:text-amber-400',
        className,
      )}
    />
  );
}

/** The errors the plan reports outside any one file. */
function PlanErrors({ errors }: { errors: readonly PlanError[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1.5">
      <h3 id={titleId} className="text-sm font-medium">
        {t('check.planErrors')}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {errors.map((error, index) => {
          const keys = error.key ? [error.key] : (error.keys ?? []);
          return (
            <li
              key={index}
              className="flex flex-wrap items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5"
            >
              <SeverityIcon severity="error" className="self-center" />
              <span>
                {keys.map((key) => (
                  <span key={key}>
                    <VariableLink name={key} />{' '}
                  </span>
                ))}
                {!keys.length && error.path && (
                  <>
                    <code className="font-mono text-xs">{error.path}</code>{' '}
                  </>
                )}
                {error.message}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The severity chips: every problem, or only errors or warnings. */
function SeverityFilter({
  counts,
  severity,
  onChange,
}: {
  counts: { all: number; error: number; warning: number };
  severity?: ProblemSeverity;
  onChange: (severity?: ProblemSeverity) => void;
}) {
  const { t } = useTranslation();
  const chips = [
    { value: undefined, label: t('check.filter.all'), count: counts.all },
    { value: 'error', label: t('check.filter.error'), count: counts.error },
    {
      value: 'warning',
      label: t('check.filter.warning'),
      count: counts.warning,
    },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t('check.filter.label')}
      className="flex flex-wrap gap-2"
    >
      {chips.map((chip) => {
        const pressed = severity === chip.value;
        return (
          <Button
            key={chip.value ?? 'all'}
            type="button"
            size="sm"
            variant={pressed ? 'secondary' : 'outline'}
            aria-pressed={pressed}
            onClick={() => onChange(chip.value)}
            className="rounded-full"
          >
            {chip.value && <SeverityIcon severity={chip.value} />}
            {chip.label}{' '}
            <span className="rounded-full bg-background/60 px-1.5 text-xs tabular-nums">
              {chip.count}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function FileReport({
  file,
  anchor,
  severity,
  variables,
  editing,
  onEdit,
}: {
  file: FileCheck;
  anchor: string;
  severity?: ProblemSeverity;
  variables: readonly Variable[];
  /** The problem whose value is being set in this file (`problemId`). */
  editing?: string;
  onEdit: (problem?: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listed = filterProblems(
    sortProblems(
      file.problems.map((problem, index) => ({
        ...problem,
        id: problemId(problem, index),
      })),
    ),
    severity,
  ) as (Problem & { id: string })[];
  const counts = countsOf(file.problems);
  const passes = file.problems.length === 0;
  return (
    <Card className={cn('px-4', passes ? 'gap-0 py-2.5' : 'gap-3')}>
      <section
        id={anchor}
        tabIndex={-1}
        aria-labelledby={titleId}
        className="flex scroll-mt-20 flex-col gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header className="flex flex-wrap items-center gap-2">
          {passes && (
            <CircleCheck
              aria-hidden="true"
              className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          )}
          <h2 id={titleId} className="font-mono text-sm font-medium">
            {file.path}
          </h2>
          {passes ? (
            <span className="text-sm text-muted-foreground">
              {t('check.passes')}
            </span>
          ) : (
            <Badge variant={STATUS_VARIANT[file.status]}>
              {t(`overview.drift.${file.status}`)}
            </Badge>
          )}
          <Badge variant="outline">{file.policy}</Badge>
          {file.template && (
            <Badge variant="outline">{t('overview.files.template')}</Badge>
          )}
          {!passes && (
            <span className="text-xs text-muted-foreground">
              {[
                counts.errors > 0 &&
                  t('check.errors', { count: counts.errors }),
                counts.warnings > 0 &&
                  t('check.warnings', { count: counts.warnings }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            <ApplyButton
              files={[file.path]}
              variant="outline"
              label={t('check.applyFile', { path: file.path })}
              show={applyFixes(file)}
            />
            <ApplyButton
              files={[file.path]}
              prune
              variant="outline"
              label={t('check.applyPrune', { path: file.path })}
              show={pruneFixes(file)}
            />
          </span>
        </header>
        {listed.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {listed.map((problem) => (
              <ProblemItem
                key={problem.id}
                file={file}
                problem={problem}
                variables={variables}
                open={editing === problem.id}
                onEdit={(open) => onEdit(open ? problem.id : undefined)}
              />
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function ProblemItem({
  file,
  problem,
  variables,
  open,
  onEdit,
}: {
  file: FileCheck;
  problem: Problem;
  variables: readonly Variable[];
  open: boolean;
  onEdit: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  // Only a variable the file holds can be set in it.
  const variable =
    problem.key && SET_CODES.has(problem.code)
      ? variables.find(
          (entry) =>
            entry.name === problem.key &&
            entry.files.some((value) => value.file === file.path),
        )
      : undefined;
  const editorTarget = editorTargetOf(file, problem);
  const others = keysOf(problem).filter((key) => key !== problem.key);
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg px-3 py-2',
        problem.severity === 'error'
          ? 'bg-muted/40'
          : 'border border-dashed border-amber-500/40',
      )}
      {...editorItem}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1 text-xs font-medium">
          <SeverityIcon severity={problem.severity} />
          {t(`check.severity.${problem.severity}`)}
        </span>
        <span data-message="" className="min-w-0 flex-1">
          <ProblemMessage file={file} problem={problem} />
        </span>
        {others.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('check.with')}{' '}
            {others.map((other) => (
              <VariableLink key={other} name={other} />
            ))}
          </span>
        )}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">
          {problem.code}
        </code>
        {problem.fix === 'apply' && (
          <span className="text-xs text-muted-foreground">
            {t('check.fix.apply')}
          </span>
        )}
        {problem.fix === 'prune' && (
          <span className="text-xs text-muted-foreground">
            {t('check.fix.prune')}
          </span>
        )}
        {variable && !open && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onEdit(true)}
          >
            <span aria-hidden="true">{t('check.set')}</span>
            <span className="sr-only">
              {t('check.setLabel', { name: variable.name, file: file.path })}
            </span>
          </Button>
        )}
        {problem.code === 'invalid-line' && (
          <Link
            to="/files"
            search={{ focus: file.path }}
            className="text-xs underline-offset-4 hover:underline"
          >
            {t('check.openFile', { path: file.path })}
          </Link>
        )}
        {editorTarget && <OpenInEditorButton target={editorTarget} />}
      </div>
      {open && variable && (
        <ValueEditor
          variable={variable}
          file={file.path}
          onDone={() => onEdit(false)}
        />
      )}
    </li>
  );
}

/**
 * What a problem says, its variable's name a link to it. The codes with a
 * fixed message say it in the portal's language; the others carry the
 * core's own message, which never holds a value.
 */
function ProblemMessage({
  file,
  problem,
}: {
  file: FileCheck;
  problem: Problem;
}) {
  const { t } = useTranslation();
  const key = problem.key && <VariableLink name={problem.key} />;
  switch (problem.code) {
    case 'missing-file':
      return <>{t('check.code.missing-file')}</>;
    case 'differs':
      return <>{t('check.code.differs')}</>;
    case 'refused':
      return <>{problem.message}</>;
    case 'mode':
      return file.mode ? (
        <>{t('check.code.mode', file.mode)}</>
      ) : (
        <>{problem.message}</>
      );
    case 'missing-key':
      return (
        <>
          {key} {t('check.code.missing-key')}
        </>
      );
    case 'invalid-line':
      return <>{t('check.code.invalid-line', { line: problem.line })}</>;
    case 'unknown-key':
      return (
        <>
          <code className="font-mono text-xs">{problem.key}</code>{' '}
          {t('check.code.unknown-key')}
        </>
      );
    default:
      return (
        <>
          {key} {problem.message}
          {problem.shown !== undefined && problem.shown !== '' && (
            <>
              : <code className="font-mono text-xs">{problem.shown}</code>
            </>
          )}
          {problem.reason && ` (${problem.reason})`}
        </>
      );
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
      <Skeleton className="h-16" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
