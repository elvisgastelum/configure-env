export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_STORAGE_KEY = 'configure-env.theme';

const THEME_CLASSES = ['light', 'dark'] as const;

// Holds a pick for this page load when storage is blocked.
let sessionPreference: ThemePreference | undefined;
const listeners = new Set<() => void>();

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** The visitor's pick on this device, or `system` when there is none. */
export function readThemePreference(): ThemePreference {
  if (sessionPreference) return sessionPreference;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Storage unavailable.
  }
  return 'system';
}

/**
 * Puts the preference on `<html>`. `system` needs no class: `theme.css`
 * follows `prefers-color-scheme` on its own, so first-time visitors get the
 * right palette from CSS alone, before any script runs. An explicit pick
 * adds `.light` or `.dark`, which wins over the media query.
 */
export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.remove(...THEME_CLASSES);
  if (preference !== 'system') root.classList.add(preference);
}

/** Applies a pick, remembers it on this device and notifies subscribers. */
export function setThemePreference(preference: ThemePreference): void {
  sessionPreference = preference;
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable: the in-memory pick still holds for this load.
  }
  applyThemePreference(preference);
  for (const listener of listeners) listener();
}

/** Subscribes to theme changes (`useSyncExternalStore` shape). */
export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: forgets the in-memory pick (storage is cleared separately). */
export function forgetSessionThemePreference(): void {
  sessionPreference = undefined;
}
