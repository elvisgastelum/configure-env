// Every page in every language, with no fallback: a key the page asks for
// and the language lacks, including one built at run time, fails the test.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, type Language, resources } from '.';
import { NAV_ITEMS } from '../lib/nav';
import { renderApp } from '../test/render';

/** An i18next instance in `language` alone, and the keys it could not find. */
function strictI18n(language: Language) {
  const missing: string[] = [];
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: (_languages, _namespace, key) => missing.push(key),
  });
  return { instance, missing };
}

it('catches a key a language lacks', () => {
  const { instance, missing } = strictI18n('es');
  instance.t('nav.nowhere' as 'nav.label');
  expect(missing).toEqual(['nav.nowhere']);
});

describe.each(LANGUAGES)('the portal in %s', (language) => {
  const copy = resources[language].translation;

  it.each(NAV_ITEMS.map((item) => [item.to, item.key] as const))(
    'renders %s with every string it needs',
    async (path, key) => {
      const { instance, missing } = strictI18n(language);
      await renderApp(path, instance);

      const nav = within(screen.getByTestId('app-sidebar')).getByRole(
        'navigation',
        { name: copy.nav.label },
      );
      expect(
        within(nav).getByRole('link', { name: copy.nav[key] }),
      ).toHaveAttribute('aria-current', 'page');
      // Let the page's data arrive, so its loaded states render too.
      await screen.findAllByRole('heading', { level: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(missing).toEqual([]);
    },
  );

  it('switches language from the header, in place', async () => {
    const user = userEvent.setup();
    const { instance, missing } = strictI18n(language);
    await renderApp('/', instance);

    const other = LANGUAGES.find((candidate) => candidate !== language)!;
    const header = screen.getByTestId('app-header');
    const group = within(header).getByRole('group', {
      name: copy.language.label,
    });
    expect(
      within(group).getByRole('button', { name: copy.language[language] }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      within(group).getByRole('button', { name: copy.language[other] }),
    );
    const next = resources[other].translation;
    expect(
      await within(screen.getByTestId('app-sidebar')).findByRole('link', {
        name: next.nav.history,
      }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: next.language[other] }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(missing).toEqual([]);
  });
});
