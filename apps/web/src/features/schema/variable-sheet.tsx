import type { SchemaDocument } from '@configure-env/core/schema';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@configure-env/design-system/components/atoms/sheet';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemaEdit } from './edits';
import type { ReviewRequest } from './review-dialog';
import { VariableFormBody } from './variable-form';
import { TypeOptions } from './type-options';
import { type TypeSwitch, TypeSwitchDialog } from './type-switch-dialog';
import {
  EMPTY_VARIABLE,
  droppedBySwitch,
  showServerErrors,
} from './variable-model';

/** Which variable the sheet edits: a name, or none to add one. */
export interface VariableTarget {
  name?: string;
}

export type RequestReview = (
  edit: SchemaEdit,
  callbacks?: Pick<ReviewRequest, 'onRefused' | 'onSaved'>,
) => void;

/** The variable form in a side sheet; submitting it opens the review. */
export function VariableSheet({
  target,
  document,
  onClose,
  onReview,
}: {
  target?: VariableTarget;
  document: SchemaDocument;
  onClose: () => void;
  onReview: RequestReview;
}) {
  const { t } = useTranslation();
  const name = target?.name;
  const [typeSwitch, setTypeSwitch] = useState<TypeSwitch>();
  return (
    <Sheet
      open={target !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('schemaEditor.variableForm.close')}
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>
            {name
              ? t('schemaEditor.variableForm.editTitle', { name })
              : t('schemaEditor.variableForm.addTitle')}
          </SheetTitle>
          <SheetDescription>
            {t('schemaEditor.variableForm.description')}
          </SheetDescription>
        </SheetHeader>
        {target && (
          <div className="px-4">
            <VariableFormBody
              key={name ?? ''}
              document={document}
              original={name}
              onCancel={onClose}
              typeOptions={(form) => (
                <TypeOptions form={form} document={document} original={name} />
              )}
              onTypeChange={(form, next, apply) => {
                const values = form.getValues();
                const dropped = droppedBySwitch(values, next);
                const clearAndApply = () => {
                  for (const field of dropped)
                    form.setValue(field, EMPTY_VARIABLE[field]);
                  apply();
                };
                if (dropped.length === 0) clearAndApply();
                else
                  setTypeSwitch({
                    from: values.type,
                    to: next,
                    dropped,
                    confirm: clearAndApply,
                  });
              }}
              onSubmit={(edit, form) =>
                onReview(edit, {
                  onSaved: onClose,
                  onRefused: (errors) =>
                    showServerErrors(form, errors, [
                      ...(edit.kind === 'addVariable' ? [edit.name] : []),
                      ...(edit.kind === 'updateVariable'
                        ? [edit.name, edit.rename ?? edit.name]
                        : []),
                    ]),
                })
              }
            />
          </div>
        )}
      </SheetContent>
      <TypeSwitchDialog
        change={typeSwitch}
        onClose={() => setTypeSwitch(undefined)}
      />
    </Sheet>
  );
}
