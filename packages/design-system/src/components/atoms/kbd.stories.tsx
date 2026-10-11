import type { Meta, StoryObj } from '@storybook/react-vite';

import { Kbd, KbdGroup } from './kbd';

/** A keyboard key or shortcut, as in "press ⌘ K". */
const meta = {
  title: 'Components/Atoms/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  args: { children: 'Esc' },
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** `KbdGroup` spaces a key combination. */
export const Shortcut: Story = {
  render: () => (
    <p className="text-sm text-muted-foreground">
      Open the command palette with{' '}
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </p>
  ),
};
