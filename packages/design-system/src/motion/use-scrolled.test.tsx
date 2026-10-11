import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useScrolled } from './use-scrolled';

function Probe({ threshold }: { threshold?: number }) {
  return <p>{useScrolled(threshold) ? 'scrolled' : 'top'}</p>;
}

function scrollTo(y: number) {
  act(() => {
    window.scrollY = y;
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('useScrolled', () => {
  afterEach(() => {
    window.scrollY = 0;
  });

  it('flips once the window scrolls past the threshold, and back', () => {
    render(<Probe />);
    expect(screen.getByText('top')).toBeInTheDocument();

    scrollTo(9);
    expect(screen.getByText('scrolled')).toBeInTheDocument();

    scrollTo(0);
    expect(screen.getByText('top')).toBeInTheDocument();
  });

  it('honours a custom threshold', () => {
    render(<Probe threshold={100} />);

    scrollTo(50);
    expect(screen.getByText('top')).toBeInTheDocument();
    scrollTo(101);
    expect(screen.getByText('scrolled')).toBeInTheDocument();
  });
});
