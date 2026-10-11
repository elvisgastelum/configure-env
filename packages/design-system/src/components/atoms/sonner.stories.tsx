import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import { Toaster, toast } from './sonner';

/**
 * Toast notifications (Sonner). Render `Toaster` once near the app root and
 * call `toast()`, `toast.success()`, `toast.error()`… from anywhere. It
 * follows the design system's theme preference.
 */
const meta = {
  title: 'Components/Atoms/Toast',
  component: Toaster,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() =>
          toast('Schema loaded', {
            description: 'env.schema.json, 12 variables',
          })
        }
      >
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.success('Files written', {
            description: '.env and .env.local are up to date.',
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info('Drift found in .env.local')}
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.warning('SESSION_SECRET has no value')}
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error('Could not write .env: permission denied')}
      >
        Error
      </Button>
    </div>
  ),
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A toast already on screen, so the a11y checks cover the toast itself. */
export const Shown: Story = {
  tags: ['!autodocs'],
  play: () => {
    toast.success('Files written', {
      description: '.env and .env.local are up to date.',
      action: { label: 'Undo', onClick: () => {} },
    });
  },
};
