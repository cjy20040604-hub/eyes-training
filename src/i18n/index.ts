import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

export type Locale = 'en' | 'zh-Hans';

/*
 * English is bundled (it is also the fallback). Other languages are separate chunks that
 * load only when used, so nobody downloads a translation they do not read. The service
 * worker precaches them, so switching language works offline too.
 */
const lazyLocales: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Record<string, unknown> }>> = {
  'zh-Hans': () => import('./zh-Hans.json'),
};

export function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('zh') ? 'zh-Hans' : 'en';
}

/** Make sure a language's strings are loaded. */
export async function loadLocale(locale: Locale): Promise<void> {
  if (locale === 'en' || i18next.hasResourceBundle(locale, 'translation')) return;
  const strings = await lazyLocales[locale]();
  i18next.addResourceBundle(locale, 'translation', strings.default, true, true);
}

/** Load a language if needed, then switch to it. */
export async function changeLocale(locale: Locale): Promise<void> {
  await loadLocale(locale);
  if (i18next.language !== locale) await i18next.changeLanguage(locale);
}

/**
 * Initialise i18next. English is available immediately; await the result before the first
 * render so another language does not flash English text first.
 */
export function initI18n(locale: Locale): Promise<void> {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources: { en: { translation: en } },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    // Keep <html lang> in step with the UI: screen readers pick their voice from it, and
    // with a wrong value Chrome offers to "translate" the page, which rewrites the DOM under
    // React and crashes it.
    i18next.on('languageChanged', (lng) => {
      if (typeof document !== 'undefined') document.documentElement.lang = lng;
    });
  }
  return changeLocale(locale);
}

export default i18next;
