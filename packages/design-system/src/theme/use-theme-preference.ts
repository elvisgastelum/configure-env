import { useSyncExternalStore } from 'react';

import {
  readThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from './theme';

/** The current theme preference, re-rendering when it changes. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeThemePreference,
    readThemePreference,
    () => 'system',
  );
}
