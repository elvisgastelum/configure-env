import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import {
  RevealGroup,
  RevealItem,
} from '@configure-env/design-system/motion/reveal';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { LayoutGroup } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  checkQuery,
  filesQuery,
  projectQuery,
  schemaQuery,
  validateQuery,
  variablesQuery,
} from '../../lib/api';
import { projectName, schemaStatus } from '../../lib/schema-status';
import { FileCard } from './file-card';
import { HealthCard } from './health-card';
import { InvalidSchema, NoSchema } from './schema-states';
import { StatCards } from './stat-cards';
import { checkIssues, countVariables, validateErrors } from './summary';

/** The project's env health: counts, files, and check and validate. */
export function OverviewPage() {
  const { t } = useTranslation();
  const { data: project } = useQuery(projectQuery);
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <p className={TYPE.eyebrow}>{t('overview.eyebrow')}</p>
        <h1 className={TYPE.subTitle}>
          {project ? projectName(project.root) : t('nav.overview')}
        </h1>
        <p className="text-pretty text-muted-foreground">
          {project
            ? t('overview.lead', { name: projectName(project.root) })
            : t('overview.leadLoading')}
        </p>
      </header>

      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('overview.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && <OverviewSkeleton />}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} />
      )}
      {status === 'valid' && <ProjectHealth />}
    </div>
  );
}

function ProjectHealth() {
  const { t } = useTranslation();
  const variables = useQuery(variablesQuery);
  const files = useQuery(filesQuery);
  const check = useQuery(checkQuery);
  const validate = useQuery(validateQuery);

  return (
    <>
      <StatCards
        counts={variables.data ? countVariables(variables.data) : undefined}
      />

      <section
        aria-labelledby="overview-health"
        className="flex flex-col gap-4"
      >
        <h2 id="overview-health" className={TYPE.cardTitle}>
          {t('overview.health.title')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <HealthCard
            title={t('overview.health.check')}
            hint={t('overview.health.checkHint')}
            to="/check"
            runLabel={t('overview.health.runCheck')}
            problems={check.data ? checkIssues(check.data) : undefined}
            problemsLabel={(count) => t('overview.health.issues', { count })}
            fetching={check.isFetching}
            error={check.error?.message}
            onRun={() => void check.refetch()}
          />
          <HealthCard
            title={t('overview.health.validate')}
            hint={t('overview.health.validateHint')}
            to="/validate"
            runLabel={t('overview.health.runValidate')}
            problems={validate.data ? validateErrors(validate.data) : undefined}
            problemsLabel={(count) => t('overview.health.errors', { count })}
            fetching={validate.isFetching}
            error={validate.error?.message}
            onRun={() => void validate.refetch()}
          />
        </div>
      </section>

      <section aria-labelledby="overview-files" className="flex flex-col gap-4">
        <h2 id="overview-files" className={TYPE.cardTitle}>
          {t('overview.files.title')}
        </h2>
        {files.data ? (
          files.data.files.length === 0 ? (
            <p className="text-muted-foreground">{t('overview.files.empty')}</p>
          ) : (
            <LayoutGroup>
              <RevealGroup as="ul" className="grid gap-3 md:grid-cols-2">
                {files.data.files.map((file) => (
                  <RevealItem as="li" key={file.path}>
                    <FileCard file={file} />
                  </RevealItem>
                ))}
              </RevealGroup>
            </LayoutGroup>
          )
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton data-testid="overview-skeleton" className="h-28" />
            <Skeleton data-testid="overview-skeleton" className="h-28" />
          </div>
        )}
      </section>
    </>
  );
}

function OverviewSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('overview.loading')}
      className="flex flex-col gap-6"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            data-testid="overview-skeleton"
            className="h-24"
          />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton data-testid="overview-skeleton" className="h-32" />
        <Skeleton data-testid="overview-skeleton" className="h-32" />
      </div>
    </div>
  );
}
