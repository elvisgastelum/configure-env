import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/History',
  component: PortalApp,
  args: { path: '/history' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The sample project's history: a schema edit, a portal edit, a secret set
 * from the CLI (which can't be undone) and a CLI edit. Undo writes to the
 * in-memory project, and the undo shows up as a change of its own.
 */
export const Timeline: Story = {};

/** Filtered from the address to the changes the CLI made. */
export const MadeInTheCli: Story = {
  args: { path: '/history?actor=cli' },
};

/** Nothing was changed yet. */
export const Empty: Story = {
  parameters: { msw: scenarios.noHistory },
};
