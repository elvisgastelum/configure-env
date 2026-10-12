import {
  applyThemePreference,
  type ThemePreference,
} from '@configure-env/design-system/theme';
import type { Decorator, Loader, Preview } from '@storybook/react-vite';
import type { RequestHandler } from 'msw';
import { setupWorker } from 'msw/browser';
import { AppProviders } from '../src/app-providers';
import { handlers } from '../src/mocks/handlers';
import { resetMockState } from '../src/mocks/store';
import { createQueryClient } from '../src/router';
import '../src/styles.css';

// Every request to /api goes to the msw handlers; a story lists its
// overrides in `parameters.msw`, ahead of the healthy defaults. Each story
// starts from the sample project again, whatever an earlier one edited.
const worker = setupWorker(...handlers);
const started = worker.start({
  onUnhandledRequest: 'bypass',
  quiet: true,
  serviceWorker: { url: './mockServiceWorker.js' },
});

const withHandlers: Loader = async ({ parameters }) => {
  await started;
  resetMockState();
  worker.resetHandlers(
    ...((parameters.msw as RequestHandler[] | undefined) ?? []),
    ...handlers,
  );
  return {};
};

/** Fresh providers (and so a fresh query cache) for every story. */
const withProviders: Decorator = (Story, { globals }) => {
  applyThemePreference((globals.theme as ThemePreference) ?? 'system');
  return (
    <AppProviders queryClient={createQueryClient()}>
      <Story />
    </AppProviders>
  );
};

const preview: Preview = {
  loaders: [withHandlers],
  decorators: [withProviders],
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
  initialGlobals: { theme: 'system' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export default preview;
