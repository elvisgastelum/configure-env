// The controls the schema forms are built from: a labelled field with its
// description and error, a select over fixed choices, a switch, and a
// picker of variable names. Each wires its label, description and error to
// the control so a screen reader reads all three.

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@configure-env/design-system/components/atoms/combobox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@configure-env/design-system/components/atoms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@configure-env/design-system/components/atoms/select';
import { Switch } from '@configure-env/design-system/components/atoms/switch';
import { XIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';

export interface FieldIds {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * A label, the control `children` renders with the ids it is given, a
 * description and the field's error.
 */
export function FormField({
  label,
  description,
  error,
  children,
  className,
}: {
  label: string;
  description?: ReactNode;
  error?: string;
  children: (ids: FieldIds) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [description && descriptionId, error && errorId]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {description && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
      {error && (
        <FieldError id={errorId} className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
    </Field>
  );
}

export interface Choice {
  value: string;
  label: string;
}

/** A select over fixed choices, named by `label`. */
export function ChoiceSelect({
  label,
  value,
  choices,
  onChange,
  disabled,
  invalid,
  describedBy,
  id,
  mono,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
  mono?: boolean;
}) {
  return (
    <Select
      items={choices}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={mono ? 'w-full font-mono' : 'w-full'}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem
            key={choice.value}
            value={choice.value}
            className={mono ? 'font-mono' : undefined}
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A switch with its label beside it and a description below. */
export function SwitchField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        onCheckedChange={onChange}
      />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && (
          <FieldDescription id={`${id}-description`}>
            {description}
          </FieldDescription>
        )}
      </div>
    </Field>
  );
}

/**
 * A multi-select of variable names, shown as chips: pick from `options`,
 * remove a chip to drop it.
 */
export function NamesPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  removeLabel,
  ids,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyLabel: string;
  removeLabel: (name: string) => string;
  ids: FieldIds;
}) {
  const anchor = useComboboxAnchor();
  return (
    <Combobox
      multiple
      items={options}
      value={value}
      onValueChange={(next) => onChange(next as string[])}
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((name) => (
              <ComboboxChip key={name} showRemove={false} className="font-mono">
                {name}
                <button
                  type="button"
                  aria-label={removeLabel(name)}
                  className="-mr-0.5 rounded-sm p-0.5 opacity-60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(value.filter((other) => other !== name));
                  }}
                >
                  <XIcon aria-hidden="true" className="size-3" />
                </button>
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          {...ids}
          aria-label={label}
          placeholder={value.length ? undefined : placeholder}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name} className="font-mono">
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
