// The portal's copy, in English and Spanish. Every string lives in a locale
// file (en.json, es.json), never in a component; the schema's own text
// (descriptions, comments, headers) is shown as written, never translated.

import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

export type Language = keyof typeof resources;

/** The languages the portal speaks, in the switcher's order. */
export const LANGUAGES = Object.keys(resources) as Language[];

/** Where an explicit pick is kept on this device. */
export const LANGUAGE_STORAGE_KEY = 'configure-env.language';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: (typeof resources)['en'];
  }
}

const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && LANGUAGES.includes(value as Language);

/** The first of `tags` the portal speaks, matched on the primary subtag. */
export function matchLanguage(tags: readonly string[]): Language | undefined {
  for (const tag of tags) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return undefined;
}

/** The pick stored on this device, if any and if still offered. */
export function storedLanguage(): Language | undefined {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The stored pick, else the browser's first language the portal speaks, else English. */
export function detectLanguage(): Language {
  return (
    storedLanguage() ??
    matchLanguage(
      typeof navigator === 'undefined'
        ? []
        : navigator.languages?.length
          ? navigator.languages
          : [navigator.language],
    ) ??
    'en'
  );
}

/** Switches `instance` to `language` and remembers the pick on this device. */
export async function setLanguage(instance: i18n, language: Language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
  await instance.changeLanguage(language);
}

/** The language `instance` speaks, as one of the portal's. */
export const currentLanguage = (instance: i18n): Language =>
  isLanguage(instance.resolvedLanguage) ? instance.resolvedLanguage : 'en';

/**
 * A ready i18next instance; synchronous, as the resources are bundled. It
 * keeps `<html lang>` on the language it speaks.
 */
export function createI18n(language: Language = detectLanguage()): i18n {
  const instance = i18next.createInstance();
  instance.on('languageChanged', () => {
    if (typeof document !== 'undefined')
      document.documentElement.lang = currentLanguage(instance);
  });
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
