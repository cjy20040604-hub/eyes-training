import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import zhHans from './zh-Hans.json';

export type Locale = 'en' | 'zh-Hans';

export function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('zh') ? 'zh-Hans' : 'en';
}

export function initI18n(locale: Locale): typeof i18next {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources: { en: { translation: en }, 'zh-Hans': { translation: zhHans } },
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18next.language !== locale) {
    void i18next.changeLanguage(locale);
  }
  return i18next;
}

export default i18next;
