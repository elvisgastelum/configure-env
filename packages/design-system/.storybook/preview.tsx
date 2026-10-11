import type { Decorator, Preview } from '@storybook/react-vite';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import { addons } from 'storybook/preview-api';

import './preview.css';

import { SiteMotionConfig } from '../src/motion/site-motion-config';
import { applyThemePreference, type ThemePreference } from '../src/theme/theme';

type DesignSystemGlobals = { theme?: ThemePreference };

const applyGlobals = ({ theme }: DesignSystemGlobals) =>
  applyThemePreference(theme ?? 'system');

// The theme toolbar applies on every page, docs-only MDX pages included
// (decorators and loaders run only for stories). The theme class lives on
// the preview's <html>, as in an app.
const channel = addons.getChannel();
const onGlobals = ({ globals }: { globals: DesignSystemGlobals }) =>
  applyGlobals(globals);
channel.on(SET_GLOBALS, onGlobals);
channel.on(GLOBALS_UPDATED, onGlobals);

/** Wraps every story in the motion defaults (easing, duration, reduced motion). */
const withSiteMotion: Decorator = (Story) => (
  <SiteMotionConfig>
    <Story />
  </SiteMotionConfig>
);

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'system', title: 'System', icon: 'browser' },
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'system' satisfies ThemePreference,
  },
  // Applied again before each story renders, so it never flashes in the
  // previous theme.
  loaders: [
    ({ globals }) => {
      applyGlobals(globals as DesignSystemGlobals);
      return {};
    },
  ],
  decorators: [withSiteMotion],
  parameters: {
    layout: 'centered',
    options: {
      // Foundations read top-down, from the introduction to motion.
      storySort: {
        order: [
          'Design System',
          [
            'Introduction',
            'Colors',
            'Typography',
            'Spacing & Layout',
            'Radius',
            'Borders & Rings',
            'Shadows & Elevation',
            'Effects',
            'Motion',
          ],
          'Components',
          ['Atoms', 'Molecules'],
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // Report violations in the panel without failing anything.
      test: 'todo',
    },
  },
};

export default preview;
