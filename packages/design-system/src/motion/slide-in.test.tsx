import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { SlideIn } from './slide-in';

/**
 * Makes `matchMedia` answer whether the viewport is two columns wide (`md`),
 * and no to everything else (such as a reduced-motion preference).
 */
function mockTwoColumns(twoColumns: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(min-width: 768px)' && twoColumns,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The slide-in wrapping the card with the given text. */
const wrapperOf = (text: string) =>
  screen.getByText(text).closest<HTMLElement>('[data-slide-from]')!;

describe('SlideIn', () => {
  it('starts each card faint and offset towards its own side from md up', () => {
    mockTwoColumns(true);
    // jsdom does not scroll, so the cards stay at the start of the effect.
    render(
      <>
        <SlideIn from="left">
          <p>Izquierda</p>
        </SlideIn>
        <SlideIn from="right">
          <p>Derecha</p>
        </SlideIn>
      </>,
    );

    const left = wrapperOf('Izquierda');
    const right = wrapperOf('Derecha');
    expect(left).toHaveAttribute('data-slide-from', 'left');
    expect(right).toHaveAttribute('data-slide-from', 'right');
    expect(left.style.transform).toContain('translateX(-56px)');
    expect(right.style.transform).toContain('translateX(56px)');
    expect(Number(left.style.opacity)).toBeCloseTo(0.3);
    expect(Number(right.style.opacity)).toBeCloseTo(0.3);
  });

  it('stays in place and opaque below md, with one stacked column', () => {
    mockTwoColumns(false);
    render(
      <SlideIn from="left">
        <p>Izquierda</p>
      </SlideIn>,
    );

    const left = wrapperOf('Izquierda');
    expect(['', 'none']).toContain(left.style.transform);
    expect(['', '1']).toContain(left.style.opacity);
  });

  it('stays in place where matchMedia is missing', () => {
    render(
      <SlideIn from="right">
        <p>Derecha</p>
      </SlideIn>,
    );

    const right = wrapperOf('Derecha');
    expect(['', 'none']).toContain(right.style.transform);
    expect(['', '1']).toContain(right.style.opacity);
  });
});
