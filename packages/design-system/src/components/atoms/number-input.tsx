import * as React from 'react';
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

type NumberInputProps = Omit<
  NumberFieldPrimitive.Root.Props,
  'render' | 'children'
> & {
  /** Accessible name of the text input when no visible label points at it. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  placeholder?: string;
  /** Accessible names of the step buttons; pass translated copy. */
  incrementLabel?: string;
  decrementLabel?: string;
};

const STEP_BUTTON =
  "flex h-full w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5";

/**
 * A number field with step buttons (Base UI `NumberField`), styled like
 * `Input`. Arrow keys step by `step` (Shift for `largeStep`), and a typed
 * value is clamped to `min`/`max` on blur.
 */
function NumberInput({
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-invalid': ariaInvalid,
  placeholder,
  incrementLabel = 'Increase',
  decrementLabel = 'Decrease',
  ...props
}: NumberInputProps) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-input"
      className={cn('w-full', className)}
      {...props}
    >
      <NumberFieldPrimitive.Group
        data-slot="number-input-group"
        className="flex h-8 w-full min-w-0 overflow-hidden rounded-lg border border-input bg-transparent transition-colors has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 data-disabled:bg-input/50 data-disabled:opacity-50 dark:bg-input/30 dark:has-aria-invalid:ring-destructive/40"
      >
        <NumberFieldPrimitive.Decrement
          data-slot="number-input-decrement"
          aria-label={decrementLabel}
          className={cn(STEP_BUTTON, 'border-r border-input')}
        >
          <MinusIcon aria-hidden />
        </NumberFieldPrimitive.Decrement>
        <NumberFieldPrimitive.Input
          data-slot="number-input-input"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-invalid={ariaInvalid}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2.5 text-center text-base tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        />
        <NumberFieldPrimitive.Increment
          data-slot="number-input-increment"
          aria-label={incrementLabel}
          className={cn(STEP_BUTTON, 'border-l border-input')}
        >
          <PlusIcon aria-hidden />
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}

export { NumberInput, type NumberInputProps };
