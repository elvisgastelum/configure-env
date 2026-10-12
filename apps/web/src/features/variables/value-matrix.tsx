import type { FileInfo, Variable } from '@configure-env/api-client';
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
import { useTranslation } from 'react-i18next';
import { CopyMenu } from './copy-menu';
import { statusesOf } from './model';
import { StatusBadges } from './status-badges';
import { SecretValue } from './secret-value';

/** A variable's value in each env file that lists it. */
export function ValueMatrix({
  variable,
  files,
  all,
}: {
  variable: Variable;
  files: readonly FileInfo[];
  /** Every variable, in schema order, to copy a whole file. */
  all: readonly Variable[];
}) {
  const { t } = useTranslation();
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
        {variable.files.map((value) => (
          <TableRow key={value.file}>
            <TableCell className="font-mono text-xs">{value.file}</TableCell>
            <TableCell>
              <StatusBadges
                statuses={statusesOf(variable, files, value.file)}
              />
            </TableCell>
            <TableCell className="max-w-56">
              <SecretValue variable={variable} file={value.file} />
              {value.error && (
                <span className="block text-xs text-destructive">
                  {value.error}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <CopyMenu
                variable={variable}
                file={value.file}
                label={t('variables.copy.menuInFile', {
                  name: variable.name,
                  file: value.file,
                })}
                fileVariables={all.filter((other) =>
                  other.files.some((entry) => entry.file === value.file),
                )}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
