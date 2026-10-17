import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';
import { LANGUAGE_STORAGE_KEY, createI18n } from '../i18n';
import { renderWithProviders } from '../test/render';
import { LanguageToggle } from './language-toggle';

describe('LanguageToggle', () => {
  it('names each language in its own language, the current one pressed', () => {
    renderWithProviders(<LanguageToggle />, createI18n('en'));

    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const spanish = screen.getByRole('button', { name: 'Español' });
    expect(spanish).toHaveAttribute('aria-pressed', 'false');
    expect(spanish).toHaveAttribute('lang', 'es');
  });

  it('switches to Spanish and back, storing the pick and <html lang>', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageToggle />, createI18n('en'));

    await user.click(screen.getByRole('button', { name: 'Español' }));
    expect(document.documentElement.lang).toBe('es');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});
