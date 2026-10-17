import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { Reveal, RevealGroup, RevealItem } from './reveal';

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

describe('reveals under reduced motion', () => {
  beforeEach(() => {
    // Nothing ever comes into view: the content must not wait for it.
    vi.spyOn(window, 'IntersectionObserver').mockImplementation(function () {
      return {
        root: null,
        rootMargin: '0px',
        scrollMargin: '0px',
        thresholds: [0],
        observe() {},
        unobserve() {},
        disconnect() {},
        takeRecords: () => [],
      };
    });
  });

  it('renders the content in place and visible at once', () => {
    render(
      <>
        <Reveal>
          <p>Contenido</p>
        </Reveal>
        <RevealGroup as="ul">
          <RevealItem as="li">Uno</RevealItem>
        </RevealGroup>
      </>,
    );

    expect(screen.getByText('Contenido')).toBeVisible();
    expect(screen.getByRole('listitem')).toBeVisible();
  });
});
