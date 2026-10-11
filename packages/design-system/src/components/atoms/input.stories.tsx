import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchIcon } from 'lucide-react';

import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group';

/** A single-line text input (Base UI `Input`), sized to match `Button`. */
const meta = {
  title: 'Components/Atoms/Input',
  component: Input,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Project name',
    placeholder: 'my-service',
    disabled: false,
  },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true, value: 'locked' } };

/** In a `Field` with a label, a description and an error. */
export const WithField: Story = {
  render: () => (
    <div className="grid w-80 gap-6">
      <Field>
        <FieldLabel htmlFor="input-url">API URL</FieldLabel>
        <Input id="input-url" placeholder="https://api.example.com" />
        <FieldDescription>Where the service sends requests.</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="input-port">Port</FieldLabel>
        <Input id="input-port" defaultValue="99999" aria-invalid />
        <FieldError>Use a port between 1 and 65535.</FieldError>
      </Field>
    </div>
  ),
};

/** `InputGroup` adds icons, text or buttons inside the border. */
export const WithAddon: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <SearchIcon aria-hidden />
      </InputGroupAddon>
      <InputGroupInput aria-label="Search variables" placeholder="Search…" />
    </InputGroup>
  ),
};
