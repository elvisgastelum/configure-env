import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/Schema',
  component: PortalApp,
  args: { path: '/schema' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The variables in schema order and the files: add, edit, reorder or remove
 * one, review the diff, and save it. Writes change the in-memory schema.
 */
export const Editor: Story = {};

/** One variable of each type the sample lacks: open one to see its options. */
export const EveryType: Story = {
  parameters: { msw: scenarios.schemaTypes },
};

/** The schema breaks the format: its errors, and no editing until it is fixed. */
export const InvalidSchema: Story = {
  parameters: { msw: scenarios.invalidSchema },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};

/** The API has not answered yet. */
export const Loading: Story = {
  parameters: { msw: scenarios.loading },
};
