import type { FileInfo, Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@configure-env/design-system/components/atoms/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@configure-env/design-system/components/atoms/tabs';
import { TYPE } from '@configure-env/design-system/recipes';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statusesOf } from '../variables/model';
import { RevealProvider, SecretValue } from '../variables/secret-value';
import { StatusBadges } from '../variables/status-badges';
import { ValueActions } from '../variables/value-actions';
import { ValueEditor } from '../variables/value-editor';
import { RawView } from './raw-view';

/**
 * One env file in full, in place of the cards: its entries in schema
 * order, each edited in place with the variables page's editor and
 * actions, and its raw text.
 */
export function FileDetail({
  file,
  files,
  variables,
  onClose,
}: {
  file: FileInfo;
  files: readonly FileInfo[];
  variables: readonly Variable[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const entries = variables.filter((variable) =>
    variable.files.some((value) => value.file === file.path),
  );
  const { unknownKeys } = file.drift;

  // A new file's detail takes the focus, so a keyboard lands on it.
  useEffect(() => title.current?.focus(), [file.path]);

  return (
    <RevealProvider>
      <section aria-labelledby={titleId} className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('files.detail.back')}
          </Button>
        </div>
        <Card className="gap-4 px-4">
          <header className="flex flex-col gap-1">
            <h2
              id={titleId}
              ref={title}
              tabIndex={-1}
              className="font-mono text-lg font-medium outline-none"
            >
              {file.path}
            </h2>
            <p className="text-sm text-muted-foreground">
              {file.template
                ? t('files.detail.descriptionTemplate', { policy: file.policy })
                : t('files.detail.description', { policy: file.policy })}
            </p>
          </header>
          <Tabs defaultValue="entries" className="gap-4">
            <TabsList aria-label={t('files.detail.tabs', { path: file.path })}>
              <TabsTrigger value="entries">
                {t('files.detail.entries')}
              </TabsTrigger>
              <TabsTrigger value="raw">{t('files.detail.raw')}</TabsTrigger>
            </TabsList>
            <TabsContent value="entries" className="flex flex-col gap-4">
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('files.detail.noEntries')}
                </p>
              ) : (
                <EntriesTable file={file} files={files} entries={entries} />
              )}
              {unknownKeys.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t('files.detail.unknown')}
                  </h3>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {unknownKeys.map((key) => (
                      <li key={key}>
                        <Badge variant="outline" className="font-mono">
                          {key}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
            <TabsContent value="raw">
              <RawView file={file} />
            </TabsContent>
          </Tabs>
        </Card>
      </section>
    </RevealProvider>
  );
}

function EntriesTable({
  file,
  files,
  entries,
}: {
  file: FileInfo;
  files: readonly FileInfo[];
  entries: readonly Variable[];
}) {
  const { t } = useTranslation();
  // The key whose value is being edited.
  const [editing, setEditing] = useState<string>();
  const path = file.path;

  return (
    <Table>
      <TableCaption
        className={`${TYPE.cardTitle} mt-0 mb-2 caption-top text-left text-foreground`}
      >
        {t('files.detail.caption', { path })}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('files.detail.key')}</TableHead>
          <TableHead>{t('files.detail.status')}</TableHead>
          <TableHead>{t('files.detail.value')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('files.detail.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((variable) => {
          const { name } = variable;
          const value = variable.files.find((entry) => entry.file === path)!;
          const isEditing = editing === name;
          const editLabel = t('variables.edit.edit', { name, file: path });
          return (
            <TableRow key={name} data-variable={name}>
              <TableHead
                scope="row"
                className="align-top font-mono text-xs font-medium"
              >
                {name}
              </TableHead>
              <TableCell className="align-top">
                <StatusBadges statuses={statusesOf(variable, files, path)} />
              </TableCell>
              <TableCell className="max-w-64 align-top whitespace-normal">
                {isEditing ? (
                  <ValueEditor
                    variable={variable}
                    file={path}
                    onDone={() => setEditing(undefined)}
                  />
                ) : (
                  <div data-testid="value">
                    <SecretValue variable={variable} file={path} />
                    {value.error && (
                      <span className="block text-xs text-destructive">
                        {value.error}
                      </span>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right align-top">
                <span className="inline-flex items-center gap-0.5">
                  {!isEditing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={editLabel}
                      title={editLabel}
                      onClick={() => setEditing(name)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                  <ValueActions variable={variable} file={path} />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
