import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover';

/** Rich, non-modal content anchored to a trigger (Base UI `Popover`). */
const meta = {
  title: 'Components/Atoms/Popover',
  component: Popover,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger render={<Button variant="outline" />}>
        Where is this set?
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>API_URL</PopoverTitle>
          <PopoverDescription>
            Set in .env and .env.local; .env.local wins.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Rendered open, so the a11y checks cover the popup itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
