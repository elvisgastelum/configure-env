import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, FieldDescription, FieldLabel } from './field';
import { Textarea } from './textarea';

/** A multi-line text input that grows with its content (`field-sizing`). */
const meta = {
  title: 'Components/Atoms/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Description',
    placeholder: 'What this variable is for…',
    disabled: false,
  },
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const WithField: Story = {
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="textarea-notes">Notes</FieldLabel>
      <Textarea id="textarea-notes" placeholder="Shown to the team" />
      <FieldDescription>Markdown is not rendered.</FieldDescription>
    </Field>
  ),
};
