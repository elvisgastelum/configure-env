import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeToggle } from './theme-toggle';

const meta = {
  title: 'Portal/ThemeToggle',
  component: ThemeToggle,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ThemeToggle>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
