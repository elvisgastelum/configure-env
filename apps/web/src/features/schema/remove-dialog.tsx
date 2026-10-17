import type { SchemaDocument } from '@configure-env/core/schema';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@configure-env/design-system/components/atoms/dialog';
import { useTranslation } from 'react-i18next';
import type { SchemaEdit } from './edits';
import { orphanedBy, referencesTo } from './references';

export type Removal =
  | { kind: 'variable'; name: string }
  | { kind: 'file'; path: string };

/**
 * Before a removal: what it leaves dangling. A variable's references (rules
 * of other variables, file lists, per-file values and comments) go with it;
 * a file's variables that no other file holds stay declared, in no file.
 */
export function RemoveDialog({
  removal,
  document,
  onCancel,
  onReview,
}: {
  removal?: Removal;
  document: SchemaDocument;
  onCancel: () => void;
  onReview: (edit: SchemaEdit) => void;
}) {
  return (
    <Dialog
      open={removal !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {removal?.kind === 'variable' && (
          <VariableRemoval
            name={removal.name}
            document={document}
            onCancel={onCancel}
            onReview={onReview}
          />
        )}
        {removal?.kind === 'file' && (
          <FileRemoval
            path={removal.path}
            document={document}
            onCancel={onCancel}
            onReview={onReview}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NameList({ label, names }: { label: string; names: string[] }) {
  return (
    <ul
      aria-label={label}
      className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm"
    >
      {names.map((name) => (
        <li
          key={name}
          className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

function Footer({
  onCancel,
  onReview,
}: {
  onCancel: () => void;
  onReview: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        {t('schemaEditor.remove.cancel')}
      </Button>
      <Button variant="destructive" onClick={onReview}>
        {t('schemaEditor.remove.review')}
      </Button>
    </DialogFooter>
  );
}

function VariableRemoval({
  name,
  document,
  onCancel,
  onReview,
}: {
  name: string;
  document: SchemaDocument;
  onCancel: () => void;
  onReview: (edit: SchemaEdit) => void;
}) {
  const { t } = useTranslation();
  const references = referencesTo(t, document, name);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('schemaEditor.remove.variableTitle', { name })}
        </DialogTitle>
        <DialogDescription>
          {references.length
            ? t('schemaEditor.remove.references', {
                count: references.length,
                name,
              })
            : t('schemaEditor.remove.noReferences', { name })}
        </DialogDescription>
      </DialogHeader>
      {references.length > 0 && (
        <NameList
          label={t('schemaEditor.remove.referencesLabel', { name })}
          names={references}
        />
      )}
      <Footer
        onCancel={onCancel}
        onReview={() =>
          onReview({
            kind: 'removeVariable',
            name,
            cleanup: references.length > 0,
          })
        }
      />
    </>
  );
}

function FileRemoval({
  path,
  document,
  onCancel,
  onReview,
}: {
  path: string;
  document: SchemaDocument;
  onCancel: () => void;
  onReview: (edit: SchemaEdit) => void;
}) {
  const { t } = useTranslation();
  const orphans = orphanedBy(document, path);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('schemaEditor.remove.fileTitle', { path })}
        </DialogTitle>
        <DialogDescription>
          {t('schemaEditor.remove.fileKeeps')}
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm">
        {orphans.length
          ? t('schemaEditor.remove.orphans', { count: orphans.length })
          : t('schemaEditor.remove.noOrphans')}
      </p>
      {orphans.length > 0 && (
        <NameList
          label={t('schemaEditor.remove.orphansLabel')}
          names={orphans}
        />
      )}
      <Footer
        onCancel={onCancel}
        onReview={() => onReview({ kind: 'removeFile', path })}
      />
    </>
  );
}
