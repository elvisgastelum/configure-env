import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW_INTERVAL_MS, useNow } from './use-now';

function Clock() {
  return <p>{useNow().toISOString()}</p>;
}

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves on once a minute while it is read', () => {
    vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00.000Z') });
    render(<Clock />);
    expect(screen.getByText('2026-10-16T12:00:00.000Z')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(NOW_INTERVAL_MS));
    expect(screen.getByText('2026-10-16T12:01:00.000Z')).toBeInTheDocument();
  });
});
