import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageToggle } from './language-toggle';

const meta = {
  title: 'Portal/LanguageToggle',
  component: LanguageToggle,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof LanguageToggle>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
