import '@testing-library/jest-dom/vitest';
import {
  applyThemePreference,
  forgetSessionThemePreference,
} from '@configure-env/design-system/theme';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { server } from './server';

// Motion's animations finish at once, so tests see final states.
MotionGlobalConfig.skipAnimations = true;

// Every test starts with no remembered choices and the system theme.
beforeEach(() => {
  window.localStorage.clear();
  forgetSessionThemePreference();
  applyThemePreference('system');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no IntersectionObserver: this stand-in reports every element in
// view at once, so reveals show their final, visible state.
class InViewIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const rect = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: null,
          time: 0,
        },
      ],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.IntersectionObserver = InViewIntersectionObserver;

// jsdom has no ResizeObserver, scrollIntoView, scrollTo or pointer capture;
// cmdk, the router and Base UI call them. Layout never moves in jsdom.
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= NoopResizeObserver;
// Sonner reads the system color scheme; jsdom has no matchMedia.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
window.scrollTo = () => {};
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.scrollTo ??= function scrollTo() {};
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
Element.prototype.hasPointerCapture ??= () => false;

// The API, through msw. An unhandled request fails the test.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
