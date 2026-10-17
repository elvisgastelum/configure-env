import type { Meta, StoryObj } from '@storybook/react-vite';
import { HttpResponse, http } from 'msw';
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
 * The sample project's report, computed from the in-memory project: set a
 * value, apply a file or prune its unknown keys, and the report runs again.
 */
export const Report: Story = {
  parameters: { msw: scenarios.liveReports },
};

/** Errors and a warning: one of every problem check reports, with its fix. */
export const ErrorsAndWarnings: Story = {
  parameters: { msw: scenarios.everyProblem },
};

/** Only warnings: unknown keys, which do not fail the check. */
export const WarningsOnly: Story = {
  parameters: { msw: scenarios.onlyWarnings },
};

/** Two dozen files: the passing ones collapse, the summary links the rest. */
export const ManyFiles: Story = {
  parameters: { msw: scenarios.manyFiles },
};

/** Every env file passes. */
export const Passing: Story = {
  parameters: { msw: scenarios.passing },
};

/** The report has not answered yet: the skeletons stay. */
export const Loading: Story = {
  parameters: { msw: scenarios.loading },
};

/** The check could not run: the page says why. */
export const Failed: Story = {
  parameters: {
    msw: [
      http.get('/api/check', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'env.schema.json could not be read' },
          { status: 500 },
        ),
      ),
    ],
  },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};
