// The locale files must say the same things: every key in every language,
// each plural form the language uses, and the same placeholders. CI runs
// this with the rest of the unit tests, so a key missing in en or es fails it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  type Language,
  createI18n,
  detectLanguage,
  matchLanguage,
  resources,
  setLanguage,
} from '.';

type Tree = { [key: string]: string | Tree };

const leaves = (tree: Tree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[prefix + key, value] as [string, string]]
      : leaves(value, `${prefix}${key}.`),
  );

const SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Each key with its plural suffix dropped, mapped to its forms' text. */
function messages(language: Language) {
  const byKey = new Map<string, Map<string, string>>();
  for (const [key, text] of leaves(resources[language].translation as Tree)) {
    const form = SUFFIX.exec(key)?.[1] ?? '';
    const base = key.replace(SUFFIX, '');
    if (!byKey.has(base)) byKey.set(base, new Map());
    byKey.get(base)!.set(form, text);
  }
  return byKey;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();

describe('the locale files', () => {
  const en = messages('en');

  it.each(LANGUAGES)('%s has every key the others have', (language) => {
    const own = [...messages(language).keys()].sort();
    for (const other of LANGUAGES)
      expect(own, `${language} against ${other}`).toEqual(
        [...messages(other).keys()].sort(),
      );
  });

  it.each(LANGUAGES)(
    '%s has each plural form its language uses, and no other',
    (language) => {
      const categories = new Intl.PluralRules(language)
        .resolvedOptions()
        .pluralCategories.slice()
        .sort();
      for (const [key, forms] of messages(language)) {
        const plural = en.get(key)?.has('other');
        expect([...forms.keys()].sort(), `${language}: ${key}`).toEqual(
          plural ? categories : [''],
        );
      }
    },
  );

  it('names each language in its own language, in every locale', () => {
    for (const language of LANGUAGES)
      for (const other of LANGUAGES)
        expect(resources[language].translation.language[other]).toBe(
          resources[other].translation.language[other],
        );
  });

  it.each(LANGUAGES)('%s uses the placeholders English uses', (language) => {
    for (const [key, forms] of messages(language)) {
      const english = new Set(
        [...en.get(key)!.values()].flatMap((text) => placeholders(text)),
      );
      for (const [form, text] of forms)
        for (const name of placeholders(text))
          expect(english, `${language}: ${key}${form && `_${form}`}`).toContain(
            name,
          );
      // A form may leave out {{count}} ("un archivo"), never anything else.
      const used = new Set([...forms.values()].flatMap((t) => placeholders(t)));
      for (const name of english)
        if (name !== 'count')
          expect(used, `${language}: ${key} drops {{${name}}}`).toContain(name);
    }
  });
});

describe('the language', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches a browser language on its primary subtag', () => {
    expect(matchLanguage(['es-MX', 'en-US'])).toBe('es');
    expect(matchLanguage(['fr-FR', 'EN-gb'])).toBe('en');
    expect(matchLanguage(['fr', 'de'])).toBeUndefined();
  });

  it("follows the browser's first language the portal speaks", () => {
    vi.stubGlobal('navigator', { languages: ['fr-CA', 'es-419', 'en'] });
    expect(detectLanguage()).toBe('es');
  });

  it('falls back to English when the browser speaks none of them', () => {
    vi.stubGlobal('navigator', { languages: ['fr', 'de'], language: 'fr' });
    expect(detectLanguage()).toBe('en');
  });

  it('prefers the pick stored on this device, if it is still offered', () => {
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'es');
    expect(detectLanguage()).toBe('es');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(detectLanguage()).toBe('en');
  });

  it('sets <html lang>, and a switch stores the pick and moves it', async () => {
    const i18n = createI18n('es');
    expect(document.documentElement.lang).toBe('es');
    expect(i18n.t('nav.history')).toBe(resources.es.translation.nav.history);

    await setLanguage(i18n, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(i18n.t('nav.history')).toBe('History');
  });

  it('picks plural forms by the language', () => {
    const es = createI18n('es');
    const en = createI18n('en');
    expect(en.t('variables.count', { count: 1 })).toBe('1 variable');
    expect(en.t('variables.count', { count: 3 })).toBe('3 variables');
    expect(es.t('variables.count', { count: 1 })).toBe(
      resources.es.translation.variables.count_one.replace('{{count}}', '1'),
    );
    expect(es.t('variables.count', { count: 1_000_000 })).toBe(
      resources.es.translation.variables.count_many.replace(
        '{{count}}',
        '1000000',
      ),
    );
  });
});
