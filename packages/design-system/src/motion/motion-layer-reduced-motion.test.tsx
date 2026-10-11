import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CardSpotlight } from './card-spotlight';
import { MaskedWords } from './masked-words';
import { RevealGroup } from './reveal';

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

describe('the motion layer under reduced motion', () => {
  it('shows masked words in place, with no offset', () => {
    render(
      <RevealGroup trigger="mount">
        <h1>
          <MaskedWords text="Software a la medida" />
        </h1>
      </RevealGroup>,
    );

    for (const word of screen.getAllByTestId('masked-word')) {
      expect(['', 'none']).toContain(word.style.transform);
    }
  });

  it('leaves the card spotlight out, even for a fine pointer', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(
      <div>
        <CardSpotlight />
      </div>,
    );

    expect(screen.queryByTestId('card-spotlight')).toBeNull();
    vi.unstubAllGlobals();
  });
});
