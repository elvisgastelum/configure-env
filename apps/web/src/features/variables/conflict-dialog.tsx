import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@configure-env/design-system/components/atoms/dialog';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { variablesQuery } from '../../lib/api';
import { SecretValue } from './secret-value';

/**
 * A write refused with 409: the file changed after the portal read it.
 * Shows the value the file has now beside the one typed, and lets the
 * person keep the file as is or save theirs on top of it.
 */
export function ConflictDialog({
  open,
  name,
  file,
  draft,
  secret,
  onKeep,
  onOverwrite,
}: {
  open: boolean;
  name: string;
  file: string;
  draft: string;
  secret: boolean;
  onKeep: () => void;
  onOverwrite: () => void;
}) {
  const { t } = useTranslation();
  // Fetched again after the refused write: the file as it is now.
  const { data } = useQuery(variablesQuery);
  const current = data?.variables.find((variable) => variable.name === name);
  const nowId = useId();
  const yoursId = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('variables.conflict.title', { file })}</DialogTitle>
          <DialogDescription>
            {t('variables.conflict.description', { name })}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt id={nowId} className="text-muted-foreground">
            {t('variables.conflict.now')}
          </dt>
          <dd aria-labelledby={nowId} className="min-w-0">
            {current ? <SecretValue variable={current} file={file} /> : '…'}
          </dd>
          <dt id={yoursId} className="text-muted-foreground">
            {t('variables.conflict.yours')}
          </dt>
          <dd aria-labelledby={yoursId} className="min-w-0 font-mono break-all">
            {secret ? '••••••••' : draft}
          </dd>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep}>
            {t('variables.conflict.keep')}
          </Button>
          <Button onClick={onOverwrite}>
            {t('variables.conflict.overwrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
