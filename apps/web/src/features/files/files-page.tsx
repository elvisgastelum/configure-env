import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import {
  RevealGroup,
  RevealItem,
} from '@configure-env/design-system/motion/reveal';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { LayoutGroup } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { filesQuery, schemaQuery, variablesQuery } from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { ApplyButton } from '../apply/apply-dialog';
import { FileCard } from '../overview/file-card';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import { FileDetail } from './file-detail';

/**
 * The env files workspace: a card per schema file, each opening its detail
 * in their place (`?focus=<path>`, as the palette jumps to it), and Apply.
 */
export function FilesPage({
  focus,
  onFocusChange,
}: {
  /** The file whose detail is open. */
  focus?: string;
  onFocusChange: (path?: string) => void;
}) {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className={TYPE.subTitle}>{t('nav.files')}</h1>
          <p className="text-pretty text-muted-foreground">{t('files.lead')}</p>
        </div>
        {status === 'valid' && <ApplyButton />}
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('files.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && <FilesSkeleton />}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} />
      )}
      {status === 'valid' && (
        <FileCards focus={focus} onFocusChange={onFocusChange} />
      )}
    </div>
  );
}

function FileCards({
  focus,
  onFocusChange,
}: {
  focus?: string;
  onFocusChange: (path?: string) => void;
}) {
  const { t } = useTranslation();
  const files = useQuery(filesQuery);
  const variables = useQuery(variablesQuery);
  const list = files.data?.files ?? [];
  const opened = list.find((file) => file.path === focus);

  if (files.error)
    return (
      <p role="alert" className="text-destructive">
        {t('files.error', { message: files.error.message })}
      </p>
    );
  if (!files.data) return <FilesSkeleton />;
  if (list.length === 0)
    return <p className="text-muted-foreground">{t('files.empty')}</p>;

  if (opened)
    return (
      <FileDetail
        key={opened.path}
        file={opened}
        files={list}
        variables={variables.data?.variables ?? []}
        onClose={() => onFocusChange(undefined)}
      />
    );

  return (
    <LayoutGroup>
      <RevealGroup as="ul" className="grid gap-3 md:grid-cols-2">
        {list.map((file) => (
          <RevealItem as="li" key={file.path}>
            <FileCard file={file} onOpen={() => onFocusChange(file.path)} />
          </RevealItem>
        ))}
      </RevealGroup>
    </LayoutGroup>
  );
}

function FilesSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('files.loading')}
      className="grid gap-3 md:grid-cols-2"
    >
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}
