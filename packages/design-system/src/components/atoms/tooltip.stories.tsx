import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyIcon } from 'lucide-react';

import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * A short label shown on hover or focus (Base UI `Tooltip`). Wrap the app
 * once in `TooltipProvider` so neighbouring tooltips share their delay.
 */
const meta = {
  title: 'Components/Atoms/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger
        render={<Button variant="outline" size="icon" aria-label="Copy" />}
      >
        <CopyIcon aria-hidden />
      </TooltipTrigger>
      <TooltipContent>Copy to clipboard</TooltipContent>
    </Tooltip>
  ),
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sides: Story = {
  render: () => (
    <div className="flex gap-2">
      {SIDES.map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger render={<Button variant="outline" />}>
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>On the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
};

/** Rendered open, so the a11y checks cover the tooltip itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
