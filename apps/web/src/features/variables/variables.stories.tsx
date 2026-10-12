import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../../mocks/handlers';
import { PortalApp } from '../../stories/portal-app';

const meta = {
  title: 'Portal/Variables',
  component: PortalApp,
  args: { path: '/variables' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every variable by group, with its value in the first file and its issues. */
export const Browser: Story = {};

/** The drawer of a protected secret: its lock, rules and value matrix. */
export const ProtectedSecret: Story = {
  args: { path: '/variables?focus=DB_PASSWORD' },
};

/** A variable with a default, enum values and a comment. */
export const EnumVariable: Story = {
  args: { path: '/variables?focus=LOG_LEVEL' },
};

/** One variable per editable type: open one and edit it. */
export const EveryType: Story = {
  args: { path: '/variables?focus=WORKERS' },
  parameters: { msw: scenarios.allTypes },
};

/** Two thousand variables: only the rows in view are rendered. */
export const LargeSchema: Story = {
  parameters: { msw: scenarios.largeSchema },
};

/** The API has not answered yet. */
export const Loading: Story = {
  parameters: { msw: scenarios.loading },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};
