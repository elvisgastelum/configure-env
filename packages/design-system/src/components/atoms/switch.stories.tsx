import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, FieldContent, FieldDescription, FieldLabel } from './field';
import { Switch } from './switch';

/** An on/off toggle that applies at once (Base UI `Switch`). */
const meta = {
  title: 'Components/Atoms/Switch',
  component: Switch,
  tags: ['autodocs'],
  args: { 'aria-label': 'Mask secrets', disabled: false, size: 'default' },
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'sm'] },
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = {
  args: { disabled: true, defaultChecked: true },
};

/** With a label and description in a horizontal `Field`. */
export const WithLabel: Story = {
  render: () => (
    <Field orientation="horizontal" className="w-80">
      <FieldContent>
        <FieldLabel htmlFor="switch-mask">Mask secrets</FieldLabel>
        <FieldDescription>Hide secret values in the list.</FieldDescription>
      </FieldContent>
      <Switch id="switch-mask" defaultChecked />
    </Field>
  ),
};
