import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/Files',
  component: PortalApp,
  args: { path: '/files' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A card per schema file: its policy, mode, template flag, whether it
 * exists, its drift and its bad lines. Apply opens the apply flow.
 */
export const Workspace: Story = {};

/** One file's entries, edited in place, and its raw text (the Raw tab). */
export const FileDetail: Story = {
  args: { path: '/files?focus=.env' },
};

/** A file that does not exist yet: its entries, and no raw text. */
export const MissingFile: Story = {
  args: { path: '/files?focus=config/app.env' },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};

/** The API has not answered yet. */
export const Loading: Story = {
  parameters: { msw: scenarios.loading },
};
