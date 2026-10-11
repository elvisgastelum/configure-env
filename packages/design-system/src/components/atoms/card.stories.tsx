import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';

import { Badge } from './badge';
import { Button } from './button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';
import { CardSpotlight } from '../../motion/card-spotlight';
import { INTERACTIVE_CARD, TYPE } from '../../recipes';
import { cn } from '../../lib/utils';

/**
 * The surface for grouped content, with optional header (title,
 * description, action), content and footer slots. `size="sm"` tightens its
 * spacing.
 */
const meta = {
  title: 'Components/Atoms/Card',
  component: Card,
  tags: ['autodocs'],
  args: { size: 'default' },
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'sm'] },
  },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Customer portal</CardTitle>
        <CardDescription>
          Orders, invoices and support in one place.
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="More options">
            <MoreHorizontal />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>
          A web app that lets your customers follow their orders without writing
          to support.
        </p>
      </CardContent>
      <CardFooter className="justify-between">
        <Badge variant="secondary">React</Badge>
        <Button size="sm">View project</Button>
      </CardFooter>
    </Card>
  ),
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 'sm' },
};

/** Header and content only, no footer. */
export const Simple: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Discovery call</CardTitle>
        <CardDescription>30 minutes, no commitment.</CardDescription>
      </CardHeader>
      <CardContent>
        We talk about your goals and I tell you how I would approach them.
      </CardContent>
    </Card>
  ),
};

/**
 * The landing's interactive card: `INTERACTIVE_CARD` lifts it and tints its
 * ring on hover or keyboard focus, and `CardSpotlight` (first child, in a
 * `relative overflow-hidden group/card` host) makes a glow follow the
 * pointer. Hover it with a mouse.
 */
export const Interactive: Story = {
  render: (args) => (
    <Card
      {...args}
      className={cn(
        'group/card relative isolate w-80 overflow-hidden',
        INTERACTIVE_CARD,
      )}
    >
      <CardSpotlight />
      <CardHeader>
        <CardTitle className={TYPE.cardTitle}>Online store</CardTitle>
        <CardDescription>Catalog, cart and payments.</CardDescription>
      </CardHeader>
      <CardContent>
        <a
          href="#projects"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Read the case study
        </a>
      </CardContent>
    </Card>
  ),
};
