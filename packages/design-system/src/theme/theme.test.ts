import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  applyThemePreference,
  readThemePreference,
  setThemePreference,
  THEME_STORAGE_KEY,
} from './theme';

const root = document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  root.classList.remove('light', 'dark');
  vi.restoreAllMocks();
});

describe('theme preference', () => {
  it('defaults to the system theme, which needs no class', () => {
    expect(readThemePreference()).toBe('system');
    applyThemePreference('system');
    expect(root.classList.contains('light')).toBe(false);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('stores an explicit pick under configure-env.theme and applies it', () => {
    expect(THEME_STORAGE_KEY).toBe('configure-env.theme');

    setThemePreference('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(readThemePreference()).toBe('dark');

    setThemePreference('light');
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('forgets the stored pick when going back to the system theme', () => {
    setThemePreference('dark');
    setThemePreference('system');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });

  it('still applies a pick when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    setThemePreference('dark');

    expect(root.classList.contains('dark')).toBe(true);
    expect(readThemePreference()).toBe('dark');
  });
});
