import type { SchemaDocument, VariableType } from '@configure-env/core/schema';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Checkbox } from '@configure-env/design-system/components/atoms/checkbox';
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
import { Label } from '@configure-env/design-system/components/atoms/label';
import { Textarea } from '@configure-env/design-system/components/atoms/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { SchemaEdit } from './edits';
import {
  ChoiceSelect,
  type FieldIds,
  FormField,
  NamesPicker,
  SwitchField,
} from './form-fields';
import { referencesTo } from './references';
import {
  EMPTY_VARIABLE,
  TYPES,
  type VariableField,
  type VariableForm,
  type VariableFormValues,
  fromSpec,
  variableFormSchema,
} from './variable-model';

const NUMERIC = new Set<VariableType>(['number', 'integer', 'port']);

/**
 * Add or edit one variable with every field env.schema.json takes. Submit
 * checks the edit against the whole schema with the core's writer and, when
 * it holds, hands the edit on for review.
 */
export function VariableFormBody({
  document,
  original,
  onSubmit,
  onCancel,
  typeOptions,
  onTypeChange,
}: {
  document: SchemaDocument;
  /** The variable edited; undefined to add one. */
  original?: string;
  onSubmit: (edit: SchemaEdit, form: VariableForm) => void;
  onCancel: () => void;
  /** The current type's options, rendered by the caller. */
  typeOptions?: (form: VariableForm) => ReactNode;
  /** Asked before the type changes; call `apply` to change it. */
  onTypeChange?: (
    form: VariableForm,
    next: VariableType,
    apply: () => void,
  ) => void;
}) {
  const { t } = useTranslation();
  const schema = useMemo(
    () => variableFormSchema(document, original),
    [document, original],
  );
  const form: VariableForm = useForm<VariableFormValues, unknown, SchemaEdit>({
    resolver: zodResolver(schema),
    defaultValues:
      original && document.variables[original]
        ? fromSpec(original, document.variables[original])
        : EMPTY_VARIABLE,
  });
  const { control, register, formState, setValue } = form;
  const errors = formState.errors;
  const errorOf = (field: VariableField) => errors[field]?.message;
  const [name, type, secret, protectedChoice, values] = useWatch({
    control,
    name: ['name', 'type', 'secret', 'protected', 'values'],
  });

  const others = Object.keys(document.variables).filter(
    (other) => other !== original && other !== name,
  );
  const groups = [
    ...new Set(
      Object.values(document.variables).flatMap((spec) =>
        spec.group ? [spec.group] : [],
      ),
    ),
  ];
  const renames = original !== undefined && name !== original;
  const references =
    renames && original ? referencesTo(t, document, original) : [];
  const listedFiles = document.files.filter((file) => file.variables !== '*');
  const rootErrors = [errors.root?.message, errors.root?.server?.message]
    .filter(Boolean)
    .join('\n');

  const rule = (field: 'requiredUnless' | 'conflictsWith' | 'distinctFrom') => (
    <FormField
      label={t(`schemaEditor.variableForm.${field}`)}
      description={t(`schemaEditor.variableForm.${field}Hint`)}
      error={errorOf(field)}
    >
      {(ids) => (
        <Controller
          control={control}
          name={field}
          render={({ field: picker }) => (
            <NamesPicker
              ids={ids}
              label={t(`schemaEditor.variableForm.${field}`)}
              options={others}
              value={picker.value}
              onChange={picker.onChange}
              placeholder={t('schemaEditor.variableForm.pickVariables')}
              emptyLabel={t('schemaEditor.variableForm.noVariables')}
              removeLabel={(other) =>
                t('schemaEditor.variableForm.removeName', { name: other })
              }
            />
          )}
        />
      )}
    </FormField>
  );

  const valueControl = (field: 'default' | 'example', ids: FieldIds) => {
    const label = t(`schemaEditor.variableForm.${field}`);
    if (type === 'boolean' || type === 'enum') {
      const options =
        type === 'boolean'
          ? ['true', 'false']
          : values.map((entry) => entry.value).filter(Boolean);
      return (
        <Controller
          control={control}
          name={field}
          render={({ field: select }) => (
            <ChoiceSelect
              id={ids.id}
              label={label}
              describedBy={ids['aria-describedby']}
              invalid={Boolean(ids['aria-invalid'])}
              mono
              value={select.value === '' ? UNSET : select.value}
              onChange={(next) => select.onChange(next === UNSET ? '' : next)}
              choices={[
                { value: UNSET, label: t('schemaEditor.variableForm.unset') },
                ...[...new Set([...options, select.value])]
                  .filter(Boolean)
                  .map((value) => ({ value, label: value })),
              ]}
            />
          )}
        />
      );
    }
    return (
      <Input
        {...ids}
        {...register(field)}
        inputMode={NUMERIC.has(type) ? 'decimal' : undefined}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
    );
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((edit) => onSubmit(edit, form))}
    >
      {rootErrors && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="text-destructive">
            {t('schemaEditor.variableForm.errors')}
          </p>
          <p className="font-mono text-xs whitespace-pre-line">{rootErrors}</p>
        </div>
      )}

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.variableForm.sections.identity')}
        </FieldLegend>
        <FormField
          label={t('schemaEditor.variableForm.name')}
          description={t('schemaEditor.variableForm.nameHint')}
          error={errorOf('name')}
        >
          {(ids) => (
            <Input
              {...ids}
              {...register('name')}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        {renames && references.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {t('schemaEditor.variableForm.rename', {
                count: references.length,
                name: original,
              })}
            </p>
            <ul
              aria-label={t('schemaEditor.variableForm.renameLabel')}
              className="flex flex-col gap-1"
            >
              {references.map((reference) => (
                <li
                  key={reference}
                  className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs"
                >
                  {reference}
                </li>
              ))}
            </ul>
          </div>
        )}
        <FormField
          label={t('schemaEditor.variableForm.type')}
          error={errorOf('type')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.variableForm.type')}
                  describedBy={ids['aria-describedby']}
                  mono
                  value={field.value}
                  choices={TYPES.map((value) => ({ value, label: value }))}
                  onChange={(next) => {
                    const apply = () => field.onChange(next);
                    if (onTypeChange)
                      onTypeChange(form, next as VariableType, apply);
                    else apply();
                  }}
                />
              )}
            />
          )}
        </FormField>
        <FormField
          label={t('schemaEditor.variableForm.description_label')}
          description={t('schemaEditor.variableForm.descriptionHint')}
          error={errorOf('description')}
        >
          {(ids) => <Input {...ids} {...register('description')} />}
        </FormField>
        <FormField
          label={t('schemaEditor.variableForm.group')}
          description={t('schemaEditor.variableForm.groupHint')}
          error={errorOf('group')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="group"
              render={({ field }) => (
                <Combobox
                  items={groups}
                  inputValue={field.value}
                  onInputValueChange={(next) => field.onChange(next)}
                  value={groups.includes(field.value) ? field.value : null}
                  onValueChange={(next) => {
                    if (typeof next === 'string') field.onChange(next);
                  }}
                >
                  <ComboboxInput
                    {...ids}
                    className="w-full"
                    triggerLabel={t('schemaEditor.variableForm.group')}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>
                      {t('schemaEditor.variableForm.groupEmpty')}
                    </ComboboxEmpty>
                    <ComboboxList>
                      {(group: string) => (
                        <ComboboxItem key={group} value={group}>
                          {group}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )}
            />
          )}
        </FormField>
        <FormField
          label={t('schemaEditor.variableForm.comment')}
          description={t('schemaEditor.variableForm.commentHint')}
          error={errorOf('comment')}
        >
          {(ids) => <Textarea {...ids} {...register('comment')} rows={2} />}
        </FormField>
      </FieldSet>

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.variableForm.sections.behavior')}
        </FieldLegend>
        <Controller
          control={control}
          name="required"
          render={({ field }) => (
            <SwitchField
              label={t('schemaEditor.variableForm.required')}
              description={
                errorOf('required') ??
                t('schemaEditor.variableForm.requiredHint')
              }
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="secret"
          render={({ field }) => (
            <SwitchField
              label={t('schemaEditor.variableForm.secret')}
              description={t('schemaEditor.variableForm.secretHint')}
              checked={field.value}
              onChange={(checked) => {
                field.onChange(checked);
                // Only a secret can be protected.
                if (!checked) setValue('protected', 'no');
              }}
            />
          )}
        />
        <FormField
          label={t('schemaEditor.variableForm.allowEmpty')}
          error={errorOf('allowEmpty')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="allowEmpty"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.variableForm.allowEmpty')}
                  value={field.value}
                  onChange={field.onChange}
                  choices={(['default', 'true', 'false'] as const).map(
                    (value) => ({
                      value,
                      label: t(
                        `schemaEditor.variableForm.allowEmptyChoices.${value}`,
                      ),
                    }),
                  )}
                />
              )}
            />
          )}
        </FormField>
        <FormField
          label={t('schemaEditor.variableForm.protected')}
          description={
            secret
              ? t('schemaEditor.variableForm.protectedHint')
              : t('schemaEditor.variableForm.protectedNeedsSecret')
          }
          error={errorOf('protected')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="protected"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.variableForm.protected')}
                  describedBy={ids['aria-describedby']}
                  invalid={Boolean(ids['aria-invalid'])}
                  disabled={!secret}
                  value={field.value}
                  onChange={field.onChange}
                  choices={(['no', 'yes', 'reason'] as const).map((value) => ({
                    value,
                    label: t(
                      `schemaEditor.variableForm.protectedChoices.${value}`,
                    ),
                  }))}
                />
              )}
            />
          )}
        </FormField>
        {protectedChoice === 'reason' && (
          <FormField
            label={t('schemaEditor.variableForm.protectedReason')}
            description={t('schemaEditor.variableForm.protectedReasonHint')}
            error={errorOf('protectedReason')}
          >
            {(ids) => <Input {...ids} {...register('protectedReason')} />}
          </FormField>
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.variableForm.sections.values')}
        </FieldLegend>
        <FormField
          label={t('schemaEditor.variableForm.default')}
          description={t('schemaEditor.variableForm.defaultHint')}
          error={errorOf('default')}
        >
          {(ids) => valueControl('default', ids)}
        </FormField>
        <FormField
          label={t('schemaEditor.variableForm.example')}
          description={t('schemaEditor.variableForm.exampleHint')}
          error={errorOf('example')}
        >
          {(ids) => valueControl('example', ids)}
        </FormField>
      </FieldSet>

      {typeOptions?.(form)}

      <FieldSet>
        <FieldLegend>
          {t('schemaEditor.variableForm.sections.rules')}
        </FieldLegend>
        {rule('requiredUnless')}
        {rule('conflictsWith')}
        {rule('distinctFrom')}
      </FieldSet>

      {original === undefined && (
        <FieldSet>
          <FieldLegend>{t('schemaEditor.variableForm.files')}</FieldLegend>
          <FieldDescription>
            {listedFiles.length
              ? t('schemaEditor.variableForm.filesHint')
              : t('schemaEditor.variableForm.noFiles')}
          </FieldDescription>
          <Controller
            control={control}
            name="files"
            render={({ field }) => (
              <div className="flex flex-col gap-2">
                {listedFiles.map((file) => (
                  <Label
                    key={file.path}
                    className="font-mono text-sm font-normal"
                  >
                    <Checkbox
                      checked={field.value.includes(file.path)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? [...field.value, file.path]
                            : field.value.filter((path) => path !== file.path),
                        )
                      }
                    />
                    {file.path}
                  </Label>
                ))}
              </div>
            )}
          />
          {errorOf('files') && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf('files')}
            </p>
          )}
        </FieldSet>
      )}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('schemaEditor.variableForm.cancel')}
        </Button>
        <Button type="submit">{t('schemaEditor.variableForm.review')}</Button>
      </div>
    </form>
  );
}

const UNSET = '__unset__';
