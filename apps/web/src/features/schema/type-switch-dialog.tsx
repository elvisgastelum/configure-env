import type { VariableType } from '@configure-env/core/schema';
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
import { fieldLabel } from './titles';
import type { VariableField } from './variable-model';

/** A type switch waiting for confirmation: what it would clear. */
export interface TypeSwitch {
  from: VariableType;
  to: VariableType;
  dropped: VariableField[];
  confirm: () => void;
}

/** Asks before a type switch clears the fields the new type does not take. */
export function TypeSwitchDialog({
  change,
  onClose,
}: {
  change?: TypeSwitch;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={change !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {change && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('schemaEditor.typeOptions.switchTitle', { type: change.to })}
              </DialogTitle>
              <DialogDescription>
                {t('schemaEditor.typeOptions.switchDescription', {
                  type: change.to,
                })}
              </DialogDescription>
            </DialogHeader>
            <ul
              aria-label={t('schemaEditor.typeOptions.switchLabel')}
              className="flex flex-col gap-1 text-sm"
            >
              {change.dropped.map((field) => (
                <li key={field} className="rounded-md bg-muted/60 px-2 py-1">
                  {fieldLabel(t, field)}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('schemaEditor.typeOptions.switchCancel', {
                  type: change.from,
                })}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  change.confirm();
                  onClose();
                }}
              >
                {t('schemaEditor.typeOptions.switchConfirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
