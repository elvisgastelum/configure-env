import type { Schema } from '@configure-env/api-client';
import type { SchemaDocument } from '@configure-env/core/schema';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@configure-env/design-system/components/atoms/tabs';
import { TYPE } from '@configure-env/design-system/recipes';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { schemaQuery } from '../../lib/api';
import { schemaStatus } from '../../lib/schema-status';
import { InvalidSchema, NoSchema } from '../overview/schema-states';
import { type SchemaEdit, validDocument } from './edits';
import { FileSheet } from './file-form';
import { FileList } from './file-list';
import { type Removal, RemoveDialog } from './remove-dialog';
import { type ReviewRequest, ReviewDialog } from './review-dialog';
import { VariableList } from './variable-list';
import { type VariableTarget, VariableSheet } from './variable-sheet';

/** env.schema.json: its variables and files, to add, change and remove. */
export function SchemaPage() {
  const { t } = useTranslation();
  const schema = useQuery(schemaQuery);
  const status = schema.data ? schemaStatus(schema.data) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t('nav.schema')}</h1>
        <p className="text-pretty text-muted-foreground">
          {t('schemaEditor.lead', {
            path: schema.data?.path ?? 'env.schema.json',
          })}
        </p>
      </header>
      {schema.error && (
        <p role="alert" className="text-destructive">
          {t('schemaEditor.error', { message: schema.error.message })}
        </p>
      )}
      {schema.isPending && (
        <div
          role="status"
          aria-label={t('schemaEditor.loading')}
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-80" />
        </div>
      )}
      {status === 'missing' && schema.data && <NoSchema schema={schema.data} />}
      {status === 'invalid' && schema.data && (
        <InvalidSchema schema={schema.data} link={false} />
      )}
      {status === 'valid' && schema.data && (
        <SchemaEditor schema={schema.data} />
      )}
    </div>
  );
}

function SchemaEditor({ schema }: { schema: Schema }) {
  const { t } = useTranslation();
  const document = validDocument(schema) as SchemaDocument;
  const [removal, setRemoval] = useState<Removal>();
  const [variable, setVariable] = useState<VariableTarget>();
  const [file, setFile] = useState<{ path?: string }>();
  const [review, setReview] = useState<ReviewRequest>();
  const reviews = useRef(0);
  const requestReview = (
    edit: SchemaEdit,
    callbacks: Pick<ReviewRequest, 'onRefused' | 'onSaved'> = {},
  ) => {
    reviews.current += 1;
    setReview({ id: reviews.current, edit, ...callbacks });
  };

  return (
    <>
      <Tabs defaultValue="variables">
        <TabsList aria-label={t('schemaEditor.tabs.label')}>
          <TabsTrigger value="variables">
            {t('schemaEditor.tabs.variables')}
          </TabsTrigger>
          <TabsTrigger value="files">
            {t('schemaEditor.tabs.files')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="variables">
          <VariableList
            document={document}
            onAdd={() => setVariable({})}
            onEdit={(name) => setVariable({ name })}
            onRemove={(name) => setRemoval({ kind: 'variable', name })}
            onReorder={(order) =>
              requestReview({ kind: 'reorderVariables', order })
            }
          />
        </TabsContent>
        <TabsContent value="files">
          <FileList
            document={document}
            onAdd={() => setFile({})}
            onEdit={(path) => setFile({ path })}
            onRemove={(path) => setRemoval({ kind: 'file', path })}
          />
        </TabsContent>
      </Tabs>
      <VariableSheet
        target={variable}
        document={document}
        onClose={() => setVariable(undefined)}
        onReview={requestReview}
      />
      <FileSheet
        target={file}
        document={document}
        onClose={() => setFile(undefined)}
        onReview={requestReview}
      />
      <RemoveDialog
        removal={removal}
        document={document}
        onCancel={() => setRemoval(undefined)}
        onReview={(edit) => {
          setRemoval(undefined);
          requestReview(edit);
        }}
      />
      <ReviewDialog request={review} onClose={() => setReview(undefined)} />
    </>
  );
}
