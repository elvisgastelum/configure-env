import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { ApplyDialog } from './apply-dialog';

const meta = {
  title: 'Portal/Apply',
  component: ApplyDialog,
  args: { open: true, onOpenChange: () => {} },
} satisfies Meta<typeof ApplyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The sample project: prompts for PORT and LOG_LEVEL (with their defaults)
 * and API_KEY (with Generate), then the plan, the confirmation and the
 * result. Applying changes the in-memory project.
 */
export const EveryFile: Story = {};

/** Apply one file, as the check page's fix does. */
export const OneFile: Story = {
  args: { files: ['config/app.env'] },
};

/** Preview a plan with every action: create, update, mode, unchanged, skip. */
export const EveryAction: Story = {
  parameters: { msw: scenarios.everyAction },
};
