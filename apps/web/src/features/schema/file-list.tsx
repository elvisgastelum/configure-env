import { isTemplate, type SchemaDocument } from '@configure-env/core/schema';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The files the schema manages, with their policy and what they hold. */
export function FileList({
  document,
  onAdd,
  onEdit,
  onRemove,
}: {
  document: SchemaDocument;
  /** Absent until an editor is wired in: no add button. */
  onAdd?: () => void;
  onEdit?: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      {onAdd && (
        <div className="flex justify-end">
          <Button size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('schemaEditor.files.add')}
          </Button>
        </div>
      )}
      {document.files.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t('schemaEditor.files.empty')}
        </p>
      ) : (
        <ul
          aria-label={t('schemaEditor.files.label')}
          className="flex flex-col divide-y rounded-lg border"
        >
          {document.files.map((file) => (
            <li
              key={file.path}
              data-file={file.path}
              className="flex flex-wrap items-center gap-2 px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm font-medium break-all">
                  {file.path}
                </span>
                <Badge variant="outline">{file.policy}</Badge>
                <Badge variant="secondary">
                  {file.variables === '*'
                    ? t('schemaEditor.files.every')
                    : t('schemaEditor.files.some', {
                        count: file.variables.length,
                      })}
                </Badge>
                {isTemplate(file) && (
                  <Badge variant="outline">
                    {t('schemaEditor.files.template')}
                  </Badge>
                )}
                {file.mode && (
                  <Badge variant="outline" className="font-mono">
                    {t('schemaEditor.files.mode', { mode: file.mode })}
                  </Badge>
                )}
              </span>
              <span className="flex items-center gap-0.5">
                {onEdit && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('schemaEditor.files.edit', {
                      path: file.path,
                    })}
                    onClick={() => onEdit(file.path)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('schemaEditor.files.remove', {
                    path: file.path,
                  })}
                  onClick={() => onRemove(file.path)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
