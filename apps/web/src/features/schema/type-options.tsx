import type { SchemaDocument } from '@configure-env/core/schema';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from '@configure-env/design-system/components/atoms/field';
import { Input } from '@configure-env/design-system/components/atoms/input';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChoiceSelect, FormField, SwitchField } from './form-fields';
import {
  type VariableField,
  type VariableForm,
  typeFields,
} from './variable-model';

/**
 * The options of the variable's type, and only those: lengths, a pattern
 * with a live tester, an encoding and bytes for a string; bounds for a
 * number or an integer; the values of an enum; the protocols of a URL; the
 * network an address or block lies within, and a block's family and
 * strictness.
 */
export function TypeOptions({
  form,
  document,
  original,
}: {
  form: VariableForm;
  document: SchemaDocument;
  original?: string;
}) {
  const { t } = useTranslation();
  const { control, register, formState } = form;
  const [type, name, pattern] = useWatch({
    control,
    name: ['type', 'name', 'pattern'],
  });
  const takes = new Set(typeFields(type));
  const errorOf = (field: VariableField) => formState.errors[field]?.message;
  const text = (
    field: VariableField,
    label: string,
    description?: string,
    numeric?: boolean,
  ) =>
    takes.has(field) && (
      <FormField label={label} description={description} error={errorOf(field)}>
        {(ids) => (
          <Input
            {...ids}
            {...register(field)}
            inputMode={numeric ? 'decimal' : undefined}
            autoComplete="off"
            spellCheck={false}
            className={numeric ? undefined : 'font-mono'}
          />
        )}
      </FormField>
    );
  const networks = Object.entries(document.variables)
    .filter(
      ([other, spec]) =>
        spec.type === 'cidr' && other !== original && other !== name,
    )
    .map(([other]) => other);

  return (
    <FieldSet>
      <FieldLegend>
        {t('schemaEditor.typeOptions.legend', { type })}
      </FieldLegend>
      {takes.size === 0 && (
        <FieldDescription>
          {t('schemaEditor.typeOptions.none', { type })}
        </FieldDescription>
      )}
      {text(
        'minLength',
        t('schemaEditor.typeOptions.minLength'),
        t('schemaEditor.typeOptions.lengthHint'),
        true,
      )}
      {text(
        'maxLength',
        t('schemaEditor.typeOptions.maxLength'),
        t('schemaEditor.typeOptions.lengthHint'),
        true,
      )}
      {text(
        'pattern',
        t('schemaEditor.typeOptions.pattern'),
        t('schemaEditor.typeOptions.patternHint'),
      )}
      {takes.has('pattern') && <PatternTester pattern={pattern} />}
      {text(
        'patternMessage',
        t('schemaEditor.typeOptions.patternMessage'),
        t('schemaEditor.typeOptions.patternMessageHint'),
      )}
      {takes.has('encoding') && (
        <FormField
          label={t('schemaEditor.typeOptions.encoding')}
          description={t('schemaEditor.typeOptions.encodingHint')}
          error={errorOf('encoding')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="encoding"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.typeOptions.encoding')}
                  describedBy={ids['aria-describedby']}
                  value={field.value || 'none'}
                  onChange={(next) =>
                    field.onChange(next === 'none' ? '' : next)
                  }
                  choices={(
                    ['none', 'base64', 'base64url', 'hex'] as const
                  ).map((value) => ({
                    value,
                    label: t(
                      `schemaEditor.typeOptions.encodingChoices.${value}`,
                    ),
                  }))}
                />
              )}
            />
          )}
        </FormField>
      )}
      {text(
        'bytes',
        t('schemaEditor.typeOptions.bytes'),
        t('schemaEditor.typeOptions.bytesHint'),
        true,
      )}
      {text('min', t('schemaEditor.typeOptions.min'), undefined, true)}
      {text('max', t('schemaEditor.typeOptions.max'), undefined, true)}
      {takes.has('values') && <ValuesEditor form={form} />}
      {text(
        'protocols',
        t('schemaEditor.typeOptions.protocols'),
        t('schemaEditor.typeOptions.protocolsHint'),
      )}
      {takes.has('within') && (
        <FormField
          label={t('schemaEditor.typeOptions.within')}
          description={
            networks.length
              ? t('schemaEditor.typeOptions.withinHint')
              : t('schemaEditor.typeOptions.noCidr')
          }
          error={errorOf('within')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="within"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.typeOptions.within')}
                  describedBy={ids['aria-describedby']}
                  invalid={Boolean(ids['aria-invalid'])}
                  mono
                  value={field.value || NONE}
                  onChange={(next) => field.onChange(next === NONE ? '' : next)}
                  choices={[
                    {
                      value: NONE,
                      label: t('schemaEditor.typeOptions.withinNone'),
                    },
                    ...[...new Set([...networks, field.value])]
                      .filter(Boolean)
                      .map((value) => ({ value, label: value })),
                  ]}
                />
              )}
            />
          )}
        </FormField>
      )}
      {takes.has('family') && (
        <FormField
          label={t('schemaEditor.typeOptions.family')}
          description={t('schemaEditor.typeOptions.familyHint')}
          error={errorOf('family')}
        >
          {(ids) => (
            <Controller
              control={control}
              name="family"
              render={({ field }) => (
                <ChoiceSelect
                  id={ids.id}
                  label={t('schemaEditor.typeOptions.family')}
                  value={field.value}
                  onChange={field.onChange}
                  choices={(['any', 'ipv4', 'ipv6'] as const).map((value) => ({
                    value,
                    label: t(`schemaEditor.typeOptions.familyChoices.${value}`),
                  }))}
                />
              )}
            />
          )}
        </FormField>
      )}
      {takes.has('strict') && (
        <Controller
          control={control}
          name="strict"
          render={({ field }) => (
            <SwitchField
              label={t('schemaEditor.typeOptions.strict')}
              description={t('schemaEditor.typeOptions.strictHint')}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      )}
    </FieldSet>
  );
}

const NONE = '__none__';

/** Tries the pattern on a sample value as it is typed; nothing is saved. */
function PatternTester({ pattern }: { pattern: string }) {
  const { t } = useTranslation();
  const [sample, setSample] = useState('');
  let result: string | undefined;
  let tone = 'text-muted-foreground';
  if (pattern && sample) {
    try {
      const matches = new RegExp(pattern, 'u').test(sample);
      result = matches
        ? t('schemaEditor.typeOptions.matches')
        : t('schemaEditor.typeOptions.noMatch');
      tone = matches ? 'text-primary' : 'text-destructive';
    } catch (error) {
      result = t('schemaEditor.typeOptions.invalidPattern', {
        message: (error as Error).message,
      });
      tone = 'text-destructive';
    }
  }
  return (
    <FormField
      label={t('schemaEditor.typeOptions.tester')}
      description={t('schemaEditor.typeOptions.testerHint')}
    >
      {(ids) => (
        <>
          <Input
            {...ids}
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p role="status" className={`text-sm ${tone}`}>
            {result}
          </p>
        </>
      )}
    </FormField>
  );
}

/** The enum's values: one input each, reordered with arrows, added and removed. */
function ValuesEditor({ form }: { form: VariableForm }) {
  const { t } = useTranslation();
  const id = useId();
  const { control, register, formState } = form;
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'values',
  });
  const error = formState.errors.values;
  const message = error?.message ?? error?.root?.message;
  return (
    <fieldset aria-labelledby={id} className="flex flex-col gap-2">
      <legend id={id} className="text-sm font-medium">
        {t('schemaEditor.typeOptions.values')}
      </legend>
      <FieldDescription>
        {t('schemaEditor.typeOptions.valuesHint')}
      </FieldDescription>
      <ol className="flex flex-col gap-1.5">
        {fields.map((field, index) => {
          const number = index + 1;
          return (
            <li key={field.id} className="flex items-center gap-1">
              <Input
                {...register(`values.${index}.value`)}
                aria-label={t('schemaEditor.typeOptions.value', {
                  index: number,
                })}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.typeOptions.moveValueUp', {
                  index: number,
                })}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.typeOptions.moveValueDown', {
                  index: number,
                })}
                disabled={index === fields.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('schemaEditor.typeOptions.removeValue', {
                  index: number,
                })}
                onClick={() => remove(index)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => append({ value: '' })}
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('schemaEditor.typeOptions.addValue')}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </fieldset>
  );
}
