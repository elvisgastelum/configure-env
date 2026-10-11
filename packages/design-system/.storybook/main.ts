import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

/*
 * The design system's own Storybook: Foundations docs, components and
 * motion. It stands on its own (no app, no i18n, no router); an app's
 * Storybook can compose it through `refs`. Port 6007 (`pnpm storybook`).
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
  // The package has no vite.config.ts; the framework adds React, and
  // Tailwind generates the utilities `preview.css` asks for.
  viteFinal(viteConfig) {
    return mergeConfig(viteConfig, { plugins: [tailwindcss()] });
  },
};

export default config;
