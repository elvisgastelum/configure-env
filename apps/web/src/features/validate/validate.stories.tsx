import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/Validate',
  component: PortalApp,
  args: { path: '/validate' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The sample project's errors, computed from the in-memory project: fix a
 * value in place, and the report runs again.
 */
export const Report: Story = {
  parameters: { msw: scenarios.liveReports },
};

/** Value, rule, protected and line errors, and a warning. */
export const EveryProblem: Story = {
  parameters: { msw: scenarios.everyProblem },
};

/** Every value follows its rules. */
export const Passing: Story = {
  parameters: { msw: scenarios.passing },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};
