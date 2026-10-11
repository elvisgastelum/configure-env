import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SlideIn } from './slide-in';

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SlideIn under reduced motion', () => {
  it('renders the cards in place and opaque, even two columns wide', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
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

    for (const text of ['Izquierda', 'Derecha']) {
      const wrapper = screen
        .getByText(text)
        .closest<HTMLElement>('[data-slide-from]')!;
      expect(['', 'none']).toContain(wrapper.style.transform);
      expect(['', '1']).toContain(wrapper.style.opacity);
    }
  });
});
