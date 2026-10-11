import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check } from 'lucide-react';

import { Badge } from './badge';

const VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
] as const;

/** A small label, such as a technology chip or a plan's tag. */
const meta = {
  title: 'Components/Atoms/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Most popular' },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'TypeScript' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'Remote' },
};

/** Every variant side by side. */
export const AllVariants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {VARIANTS.map((variant) => (
        <Badge key={variant} {...args} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

/** An icon before the label, marked `data-icon` so the padding adjusts. */
export const WithIcon: Story = {
  render: (args) => (
    <Badge {...args}>
      <Check data-icon="inline-start" />
      Available
    </Badge>
  ),
};

/** Rendered as a link through the `render` prop; links get a hover tint. */
export const AsLink: Story = {
  args: {
    variant: 'outline',
    render: <a href="#pricing" />,
    children: 'See pricing',
  },
};
