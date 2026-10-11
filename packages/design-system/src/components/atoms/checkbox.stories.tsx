import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from './checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from './field';

/** A box that marks an option as chosen (Base UI `Checkbox`). */
const meta = {
  title: 'Components/Atoms/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { 'aria-label': 'Required', disabled: false },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = { args: { disabled: true } };

/** A group of labelled options in a `FieldSet`. */
export const Group: Story = {
  render: () => (
    <FieldSet className="w-72">
      <FieldLegend variant="label">Files to write</FieldLegend>
      <FieldGroup className="gap-3">
        {['.env', '.env.local', '.env.test'].map((file, index) => (
          <Field key={file} orientation="horizontal">
            <Checkbox id={`checkbox-${index}`} defaultChecked={index === 0} />
            <FieldLabel htmlFor={`checkbox-${index}`} className="font-normal">
              {file}
            </FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  ),
};
