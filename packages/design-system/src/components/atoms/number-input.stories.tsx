import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, FieldDescription, FieldLabel } from './field';
import { NumberInput } from './number-input';

/**
 * A number field with step buttons (Base UI `NumberField`). Arrow keys step
 * the value; a typed value is clamped to `min`/`max` on blur.
 */
const meta = {
  title: 'Components/Atoms/NumberInput',
  component: NumberInput,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Port',
    defaultValue: 8080,
    min: 1,
    max: 65535,
    disabled: false,
  },
  render: (args) => (
    <div className="w-48">
      <NumberInput {...args} />
    </div>
  ),
} satisfies Meta<typeof NumberInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const WithField: Story = {
  render: () => (
    <Field className="w-56">
      <FieldLabel htmlFor="number-retries">Retries</FieldLabel>
      <NumberInput
        id="number-retries"
        defaultValue={3}
        min={0}
        max={10}
        incrementLabel="More retries"
        decrementLabel="Fewer retries"
      />
      <FieldDescription>Between 0 and 10.</FieldDescription>
    </Field>
  ),
};
