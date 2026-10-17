import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { Reveal, RevealGroup, RevealItem } from './reveal';

describe('Reveal', () => {
  it('shows its content once it is in view', async () => {
    render(
      <Reveal>
        <p>Contenido</p>
      </Reveal>,
    );

    await waitFor(() => expect(screen.getByText('Contenido')).toBeVisible());
  });

  it('renders the element it is asked for', async () => {
    render(
      <Reveal as="section" aria-label="Bloque" direction="left" delay={0.2}>
        <p>Contenido</p>
      </Reveal>,
    );

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Bloque' })).toBeVisible(),
    );
  });
});

describe('RevealGroup', () => {
  it('shows every item of a list', async () => {
    render(
      <RevealGroup as="ul" aria-label="Lista">
        {['Uno', 'Dos', 'Tres'].map((item) => (
          <RevealItem as="li" key={item}>
            {item}
          </RevealItem>
        ))}
      </RevealGroup>,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    await waitFor(() => {
      for (const item of items) {
        expect(item).toBeVisible();
      }
    });
  });
});
