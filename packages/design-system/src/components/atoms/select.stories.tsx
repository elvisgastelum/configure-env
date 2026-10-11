import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, FieldLabel } from './field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

const ENVIRONMENTS = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
];

/** Picks one value from a short list (Base UI `Select`). */
const meta = {
  title: 'Components/Atoms/Select',
  component: Select,
  tags: ['autodocs'],
  render: () => (
    <Field className="w-64">
      <FieldLabel id="select-env-label">Environment</FieldLabel>
      <Select items={ENVIRONMENTS} defaultValue="staging">
        <SelectTrigger aria-labelledby="select-env-label" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Deployed</SelectLabel>
            {ENVIRONMENTS.slice(1).map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="development">Development</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  ),
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = {
  render: () => (
    <Select items={ENVIRONMENTS} defaultValue="production">
      <SelectTrigger aria-label="Environment" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ENVIRONMENTS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};
