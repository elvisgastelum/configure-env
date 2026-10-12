import type { Meta, StoryObj } from '@storybook/react-vite';
import { scenarios } from '../mocks/handlers';
import { PortalApp } from './portal-app';

const meta = {
  title: 'Portal/App',
  component: PortalApp,
  args: { path: '/' },
} satisfies Meta<typeof PortalApp>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A project with drift: a missing key, a wrong mode and an invalid value. */
export const Overview: Story = {};

/** Every env file matches the schema. */
export const Passing: Story = {
  parameters: { msw: scenarios.passing },
};

/** The API has not answered yet. */
export const Loading: Story = {
  parameters: { msw: scenarios.loading },
};

/** The project has no schema: the empty state points at init. */
export const NoSchema: Story = {
  parameters: { msw: scenarios.noSchema },
};

/** The schema exists but breaks the format. */
export const InvalidSchema: Story = {
  parameters: { msw: scenarios.invalidSchema },
};

/** No session cookie: the portal asks for the launch link. */
export const Unauthorized: Story = {
  parameters: { msw: scenarios.unauthorized },
};

/** A page the next tickets fill, opened from the palette on a file. */
export const PlaceholderPage: Story = {
  args: { path: '/files?focus=.env' },
};
