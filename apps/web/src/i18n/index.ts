// The portal's copy. English ships first; every string lives in a locale
// file (en.json), never in a component.

import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

export const resources = { en: { translation: en } } as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: (typeof resources)['en'];
  }
}

/** A ready i18next instance; synchronous, as the resources are bundled. */
export function createI18n(language = 'en'): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
