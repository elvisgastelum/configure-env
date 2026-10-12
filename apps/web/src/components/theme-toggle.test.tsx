import { THEME_STORAGE_KEY } from '@configure-env/design-system/theme';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  it('starts on the system theme with no class on <html>', () => {
    renderWithProviders(<ThemeToggle />);

    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
  });

  it('switches to dark, then light, then back to system', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement).not.toHaveClass('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('is one labelled group', () => {
    renderWithProviders(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });
});
