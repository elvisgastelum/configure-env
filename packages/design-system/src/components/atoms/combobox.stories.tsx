import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './combobox';

const VARIABLES = [
  'API_URL',
  'DATABASE_URL',
  'LOG_LEVEL',
  'PORT',
  'SENTRY_DSN',
  'SESSION_SECRET',
];

/** A text input that filters a list of options as you type. */
const meta = {
  title: 'Components/Atoms/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  render: () => (
    <Combobox items={VARIABLES}>
      <ComboboxInput
        aria-label="Variable"
        placeholder="Find a variable"
        className="w-64"
      />
      <ComboboxContent>
        <ComboboxEmpty>No variable found.</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
} satisfies Meta<typeof Combobox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** `showClear` adds a button that empties the input. */
export const Clearable: Story = {
  render: () => (
    <Combobox items={VARIABLES} defaultValue="PORT">
      <ComboboxInput aria-label="Variable" showClear className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No variable found.</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};
