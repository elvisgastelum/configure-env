import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from './skeleton';
import { Spinner } from './spinner';

/** A pulsing placeholder in the shape of content that is still loading. */
const meta = {
  title: 'Components/Atoms/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  args: { className: 'h-4 w-48' },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A card-shaped placeholder: avatar, title and two lines. */
export const Card: Story = {
  render: () => (
    <div
      className="flex w-80 items-center gap-4"
      role="status"
      aria-label="Loading project"
    >
      <Skeleton className="size-10 rounded-full" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  ),
};

/** `Spinner` for a loading state with no known shape. */
export const WithSpinner: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner aria-label="Loading variables" />
      Loading variables…
    </div>
  ),
};
