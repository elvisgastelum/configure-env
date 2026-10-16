import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/Check',
  component: PortalApp,
  args: { path: '/check' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The sample project's drift, computed from the in-memory project: set a
 * value or apply a file, and the report runs again.
 */
export const Report: Story = {
  parameters: { msw: scenarios.liveReports },
};

/** One of every item check reports, with its link and fix. */
export const EveryProblem: Story = {
  parameters: { msw: scenarios.everyProblem },
};

/** Every env file matches the schema. */
export const Passing: Story = {
  parameters: { msw: scenarios.passing },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};
