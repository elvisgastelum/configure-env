import { isTemplate, type SchemaDocument } from '@configure-env/core/schema';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@configure-env/design-system/components/atoms/combobox';
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from '@configure-env/design-system/components/atoms/field';
import { Input } from '@configure-env/design-system/components/atoms/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@configure-env/design-system/components/atoms/sheet';
import { Textarea } from '@configure-env/design-system/components/atoms/textarea';
import { cn } from '@configure-env/design-system/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FILE_POLICIES } from '@configure-env/core/schema';
import type { SchemaEdit } from './edits';
import { ChoiceSelect, FormField, SwitchField } from './form-fields';
import {
  EMPTY_FILE,
  type FileForm,
  type FileFormValues,
  fileFormSchema,
  fromFile,
  heldVariables,
  showFileServerErrors,
} from './file-model';
import { moveItem, useDragReorder } from './reorder';
import type { RequestReview } from './variable-sheet';

/** The file form in a side sheet; submitting it opens the review. */
export function FileSheet({
  target,
  document,
  onClose,
  onReview,
}: {
  /** The file edited, by path; `{}` to add one; undefined when closed. */
  target?: { path?: string };
  document: SchemaDocument;
  onClose: () => void;
  onReview: RequestReview;
}) {
  const { t } = useTranslation();
  const path = target?.path;
  return (
    <Sheet
      open={target !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('schemaEditor.fileForm.close')}
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>
            {path
              ? t('schemaEditor.fileForm.editTitle', { path })
              : t('schemaEditor.fileForm.addTitle')}
          </SheetTitle>
          <SheetDescription>
            {t('schemaEditor.fileForm.description')}
          </SheetDescription>
        </SheetHeader>
        {target && (
          <div className="px-4">
            <FileFormBody
              key={path ?? ''}
              document={document}
              original={path}
              onCancel={onClose}
              onSubmit={(edit, form) =>
                onReview(edit, {
                  onSaved: onClose,
                  onRefused: (errors) =>
                    showFileServerErrors(form, errors, document, path),
                })
              }
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Add or edit one file with every field env.schema.json takes. */
function FileFormBody({
  document,
  original,
  onSubmit,
  onCancel,
}: {
  document: SchemaDocument;
  original?: string;
  onSubmit: (edit: SchemaEdit, form: FileForm) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const schema = useMemo(
    () => fileFormSchema(document, original),
    [document, original],
  );
  const current = document.files.find((file) => file.path === original);
  const form: FileForm = useForm<FileFormValues, unknown, SchemaEdit>({
    resolver: zodResolver(schema),
    defaultValues: current ? fromFile(current) : EMPTY_FILE,
  });
  const { control, register, formState } = form;
  const errors = formState.errors;
  const [path, everyVariable, variables] = useWatch({
    control,
    name: ['path', 'everyVariable', 'variables'],
  });
  const held = heldVariables(document, { everyVariable, variables });
  const rootErrors = [errors.root?.message, errors.root?.server?.message]
    .filter(Boolean)
    .join('\n');
  const byName = isTemplate({ path, template: undefined });

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((edit) => onSubmit(edit, form))}
    >
      {rootErrors && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="text-destructive">
            {t('schemaEditor.fileForm.errors')}
          </p>
          <p className="font-mono text-xs whitespace-pre-line">{rootErrors}</p>
        </div>
      )}

      <FieldSet>
        <FieldLegend>{t('schemaEditor.fileForm.sections.file')}</FieldLegend>
        <FormField
          label={t('schemaEditor.fileForm.path')}
          description={t('schemaEditor.fileForm.pathHint')}
          error={errors.path?.message}
        >
          {(ids) => (
            <Input
              {...ids}
              {...register('path')}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">
            {t('schemaEditor.fileForm.policy')}
          </legend>
          {FILE_POLICIES.map((policy) => (
            <label
              key={policy}
              className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 has-checked:border-primary/40 has-checked:bg-primary/5"
            >
              <input
                type="radio"
                value={policy}
                {...register('policy')}
                className="mt-1 accent-(--primary)"
              />
              <span className="flex flex-col">
                <span className="font-mono text-sm font-medium">
                  {t(`schemaEditor.fileForm.policies.${policy}.label`)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`schemaEditor.fileForm.policies.${policy}.description`)}
                </span>
              </span>
            </label>
          ))}
          {errors.policy?.message && (
            <p role="alert" className="text-sm text-destructive">
              {errors.policy.message}
            </p>
          )}
        </fieldset>
        <FormField
          label={t('schemaEditor.fileForm.mode')}
          description={t('schemaEditor.fileForm.modeHint')}
          error={errors.mode?.message}
        >
          {(ids) => (
            <Input
              {...ids}
              {...register('mode')}
              inputMode="numeric"
              autoComplete="off"
              className="w-24 font-mono"
            />
          )}
        </FormField>
        <FormField
          label={t('schemaEditor.fileForm.template')}
          description={t('schemaEditor.fileForm.templateHint')}
          error={errors.template?.message}
        >
          {(ids) => (
            <Controller
              control={control}
              name="template"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.fileForm.template')}
                  describedBy={ids['aria-describedby']}
                  value={field.value}
                  onChange={field.onChange}
                  choices={(['default', 'true', 'false'] as const).map(
                    (value) => ({
                      value,
                      label: t(
                        `schemaEditor.fileForm.templateChoices.${value}`,
                        {
                          now: byName
                            ? t('schemaEditor.fileForm.yes')
                            : t('schemaEditor.fileForm.no'),
                        },
                      ),
                    }),
                  )}
                />
              )}
            />
          )}
        </FormField>
      </FieldSet>

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.fileForm.sections.variables')}
        </FieldLegend>
        <Controller
          control={control}
          name="everyVariable"
          render={({ field }) => (
            <SwitchField
              label={t('schemaEditor.fileForm.everyVariable')}
              description={t('schemaEditor.fileForm.everyVariableHint')}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {!everyVariable && (
          <Controller
            control={control}
            name="variables"
            render={({ field }) => (
              <VariableOrder
                declared={Object.keys(document.variables)}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        )}
        {errors.variables?.message && (
          <p role="alert" className="text-sm text-destructive">
            {errors.variables.message}
          </p>
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend>{t('schemaEditor.fileForm.sections.text')}</FieldLegend>
        <FormField
          label={t('schemaEditor.fileForm.header')}
          description={t('schemaEditor.fileForm.headerHint')}
          error={errors.header?.message}
        >
          {(ids) => <Textarea {...ids} {...register('header')} rows={2} />}
        </FormField>
        <FormField
          label={t('schemaEditor.fileForm.description_label')}
          error={errors.description?.message}
        >
          {(ids) => <Input {...ids} {...register('description')} />}
        </FormField>
      </FieldSet>

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.fileForm.sections.overrides')}
        </FieldLegend>
        <Overrides form={form} kind="values" held={held} />
        <Overrides form={form} kind="comments" held={held} />
      </FieldSet>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('schemaEditor.fileForm.cancel')}
        </Button>
        <Button type="submit">{t('schemaEditor.fileForm.review')}</Button>
      </div>
    </form>
  );
}

/** The file's own variable list: pick variables, then order them. */
function VariableOrder({
  declared,
  value,
  onChange,
}: {
  declared: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const left = declared.filter((name) => !value.includes(name));
  const move = (from: number, to: number) =>
    onChange(moveItem(value, from, to));
  const { itemProps } = useDragReorder(move);
  return (
    <div className="flex flex-col gap-2">
      <Combobox
        items={left}
        value={null}
        onValueChange={(name) => {
          if (typeof name === 'string') onChange([...value, name]);
        }}
      >
        <ComboboxInput
          aria-label={t('schemaEditor.fileForm.addVariable')}
          placeholder={t('schemaEditor.fileForm.addVariable')}
          triggerLabel={t('schemaEditor.fileForm.addVariable')}
          className="w-full"
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {t('schemaEditor.fileForm.noVariablesLeft')}
          </ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name} className="font-mono">
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {value.length === 0 ? (
        <FieldDescription>
          {t('schemaEditor.fileForm.listEmpty')}
        </FieldDescription>
      ) : (
        <ol
          aria-label={t('schemaEditor.fileForm.listLabel')}
          className="flex flex-col divide-y rounded-lg border"
        >
          {value.map((name, index) => (
            <li
              key={name}
              data-variable={name}
              {...itemProps(index)}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 data-dragging:opacity-50',
              )}
            >
              <GripVertical
                aria-label={t('schemaEditor.fileForm.drag', { name })}
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
              />
              <span className="flex-1 font-mono text-sm">{name}</span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.fileForm.moveUp', { name })}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.fileForm.moveDown', { name })}
                disabled={index === value.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.fileForm.remove', { name })}
                onClick={() =>
                  onChange(value.filter((other) => other !== name))
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The rows of `values` or `comments`: a variable of the file and its text. */
function Overrides({
  form,
  kind,
  held,
}: {
  form: FileForm;
  kind: 'values' | 'comments';
  held: string[];
}) {
  const { t } = useTranslation();
  const { control, register, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: kind });
  const rowErrors = formState.errors[kind];
  const message = rowErrors?.message ?? rowErrors?.root?.message;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {t(`schemaEditor.fileForm.${kind}`)}
        </p>
        <FieldDescription>
          {t(`schemaEditor.fileForm.${kind}Hint`)}
        </FieldDescription>
      </div>
      {fields.map((row, index) => {
        const number = index + 1;
        const error = rowErrors?.[index];
        const textField = kind === 'values' ? 'value' : 'comment';
        const textError =
          kind === 'values'
            ? (error as { value?: { message?: string } } | undefined)?.value
                ?.message
            : (error as { comment?: { message?: string } } | undefined)?.comment
                ?.message;
        return (
          <div
            key={row.id}
            className="flex flex-col gap-1 rounded-lg border p-2"
          >
            <div className="flex items-start gap-2">
              <Controller
                control={control}
                name={`${kind}.${index}.name`}
                render={({ field }) => (
                  <div className="w-1/2 min-w-0">
                    <ChoiceSelect
                      label={t('schemaEditor.fileForm.rowVariable', {
                        kind,
                        index: number,
                      })}
                      mono
                      invalid={Boolean(error?.name)}
                      value={field.value || PICK}
                      onChange={(next) =>
                        field.onChange(next === PICK ? '' : next)
                      }
                      choices={[
                        { value: PICK, label: t('schemaEditor.fileForm.pick') },
                        ...[...new Set([...held, field.value])]
                          .filter(Boolean)
                          .map((value) => ({ value, label: value })),
                      ]}
                    />
                  </div>
                )}
              />
              {kind === 'values' ? (
                <Input
                  {...register(`values.${index}.value`)}
                  aria-label={t('schemaEditor.fileForm.rowValue', {
                    index: number,
                  })}
                  aria-invalid={textError ? true : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              ) : (
                <Textarea
                  {...register(`comments.${index}.comment`)}
                  aria-label={t('schemaEditor.fileForm.rowComment', {
                    index: number,
                  })}
                  rows={1}
                />
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.fileForm.removeRow', {
                  kind,
                  index: number,
                })}
                onClick={() => remove(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {(
              [
                ['name', error?.name?.message],
                [textField, textError],
              ] as const
            )
              .filter(([, text]) => Boolean(text))
              .map(([field, text]) => (
                <p
                  key={field}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {text}
                </p>
              ))}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() =>
          kind === 'values'
            ? append({ name: '', value: '' } as never)
            : append({ name: '', comment: '' } as never)
        }
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {kind === 'values'
          ? t('schemaEditor.fileForm.addValue')
          : t('schemaEditor.fileForm.addComment')}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

const PICK = '__pick__';
