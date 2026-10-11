import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Plus, Send } from 'lucide-react';

import { Button } from './button';

const VARIANTS = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
] as const;

const SIZES = ['xs', 'sm', 'default', 'lg'] as const;

const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const;

/**
 * The base button (Base UI's `Button` with the shadcn variants). Calls to
 * action on the landing use `ctaClassName` from the design system recipes,
 * which builds on the `default` and `outline` variants.
 */
const meta = {
  title: 'Components/Atoms/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Get a quote', disabled: false },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
    size: { control: 'select', options: [...SIZES, ...ICON_SIZES] },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = {
  args: { variant: 'outline' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete draft' },
};

export const Link: Story = {
  args: { variant: 'link', children: 'See the process' },
};

/** Every variant at every text size. */
export const VariantsAndSizes: Story = {
  parameters: { layout: 'padded' },
  render: (args) => (
    <div className="grid gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <span className="w-24 font-mono text-xs text-muted-foreground">
            {variant}
          </span>
          {SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              {size}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The square icon sizes; an icon-only button needs an `aria-label`. */
export const IconSizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {ICON_SIZES.map((size) => (
        <Button
          key={size}
          {...args}
          variant="outline"
          size={size}
          aria-label={`Add (${size})`}
        >
          <Plus />
        </Button>
      ))}
    </div>
  ),
};

/** An icon beside the label, marked `data-icon` so the padding adjusts. */
export const WithIcon: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args}>
        <Send data-icon="inline-start" />
        Send request
      </Button>
      <Button {...args} variant="outline">
        Continue
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Rendered as a link through Base UI's `render` prop. */
export const AsLink: Story = {
  args: {
    variant: 'outline',
    nativeButton: false,
    render: <a href="#contact" />,
    children: 'Contact me',
  },
};
