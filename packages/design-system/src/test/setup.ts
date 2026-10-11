import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, vi } from 'vitest';

import {
  applyThemePreference,
  forgetSessionThemePreference,
} from '../theme/theme';

// Motion's animations finish at once, so tests see final states.
MotionGlobalConfig.skipAnimations = true;

// Every test starts with no remembered choices and the system theme.
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  forgetSessionThemePreference();
  applyThemePreference('system');
});

afterEach(() => {
  cleanup();
  // Restored here, not in a file's own hooks: this file's `beforeEach` runs
  // first and would otherwise call a spy a previous test left mocked.
  vi.restoreAllMocks();
});

// jsdom has no IntersectionObserver. Reveals wait on one, so this stand-in
// reports every observed element as in view at once, and tests see the
// content in its final, visible state.
class InViewIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
      time: 0,
    };
    this.callback([entry], this);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.IntersectionObserver = InViewIntersectionObserver;
