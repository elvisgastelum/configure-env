import type { FileInfo, Variable } from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@configure-env/design-system/components/atoms/table';
import { TYPE } from '@configure-env/design-system/recipes';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyMenu } from './copy-menu';
import { statusesOf } from './model';
import { SecretValue } from './secret-value';
import { StatusBadges } from './status-badges';
import { ValueActions } from './value-actions';
import { ValueEditor } from './value-editor';

/**
 * A variable's value in each env file that lists it, with the actions on
 * each: edit in place, generate or unset, and copy.
 */
export function ValueMatrix({
  variable,
  files,
  all,
  editing,
  onEditingChange,
}: {
  variable: Variable;
  files: readonly FileInfo[];
  /** Every variable, in schema order, to copy a whole file. */
  all: readonly Variable[];
  /** The file whose value is being edited. */
  editing?: string;
  onEditingChange: (file?: string) => void;
}) {
  const { t } = useTranslation();
  const { name } = variable;
  if (variable.files.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t('variables.drawer.notInFiles')}
      </p>
    );
  return (
    <Table>
      <TableCaption
        className={`${TYPE.cardTitle} mt-0 mb-2 caption-top text-left text-foreground`}
      >
        {t('variables.drawer.values')}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('variables.drawer.file')}</TableHead>
          <TableHead>{t('variables.drawer.status')}</TableHead>
          <TableHead>{t('variables.drawer.value')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('variables.drawer.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {variable.files.map((value) => {
          const isEditing = editing === value.file;
          const editLabel = t('variables.edit.edit', {
            name,
            file: value.file,
          });
          return (
            <TableRow key={value.file} data-file={value.file}>
              <TableCell className="align-top font-mono text-xs">
                {value.file}
              </TableCell>
              <TableCell className="align-top">
                <StatusBadges
                  statuses={statusesOf(variable, files, value.file)}
                />
              </TableCell>
              <TableCell className="max-w-64 align-top whitespace-normal">
                {isEditing ? (
                  <ValueEditor
                    variable={variable}
                    file={value.file}
                    onDone={() => onEditingChange(undefined)}
                  />
                ) : (
                  <div data-testid="value">
                    <SecretValue variable={variable} file={value.file} />
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
                      onClick={() => onEditingChange(value.file)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                  <ValueActions variable={variable} file={value.file} />
                  <CopyMenu
                    variable={variable}
                    file={value.file}
                    label={t('variables.copy.menuInFile', {
                      name,
                      file: value.file,
                    })}
                    fileVariables={all.filter((other) =>
                      other.files.some((entry) => entry.file === value.file),
                    )}
                  />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
