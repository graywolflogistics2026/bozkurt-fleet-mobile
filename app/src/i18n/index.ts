import 'intl-pluralrules';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '@/src/i18n/config';
import { clearCachedLocale, getCachedLocale, setCachedLocale } from '@/src/i18n/localeStorage';
import en from '@/src/i18n/locales/en.json';
import es from '@/src/i18n/locales/es.json';
import ru from '@/src/i18n/locales/ru.json';
import ar from '@/src/i18n/locales/ar.json';
import tr from '@/src/i18n/locales/tr.json';

const resources = {
  en: { translation: en },
  es: { translation: es },
  ru: { translation: ru },
  ar: { translation: ar },
  tr: { translation: tr },
};

// FIRST-LAUNCH RULE (owner decision 2026-07-09, PRODUCT DECISION): the app
// opens in the device's OS language when it's one of the 5 supported ones;
// anything else falls back to English. A manual choice made later in
// Settings (cached here, and mirrored to profiles.locale) always wins over
// the device language on every subsequent launch/device.
export function detectDeviceLocale(): SupportedLocale {
  const code = Localization.getLocales()[0]?.languageCode;
  return isSupportedLocale(code) ? code : DEFAULT_LOCALE;
}

export async function resolveInitialLocale(): Promise<SupportedLocale> {
  const cached = await getCachedLocale();
  return cached ?? detectDeviceLocale();
}

let initPromise: Promise<void> | null = null;

// Called once at app boot (see app/_layout.tsx) before any screen renders,
// so no screen ever flashes the wrong language.
export function initI18n(): Promise<void> {
  if (!initPromise) {
    initPromise = resolveInitialLocale().then((locale) =>
      i18n
        .use(initReactI18next)
        .init({
          resources,
          lng: locale,
          fallbackLng: DEFAULT_LOCALE,
          interpolation: { escapeValue: false },
          compatibilityJSON: 'v4',
        })
        .then(() => undefined)
    );
  }
  return initPromise;
}

// Called from Settings (manual override) and from AuthContext (profile
// sync on sign-in, in case this device's cache disagrees with the account's
// own profiles.locale — "always wins ... on every device they sign into").
export async function setAppLocale(locale: SupportedLocale): Promise<void> {
  await setCachedLocale(locale);
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
}

// Settings > Language > "Match device language" — clears the stored
// override (both locally and, by the caller, in profiles.locale) and
// switches to whatever the device's own OS language resolves to.
export async function resetAppLocaleToDevice(): Promise<SupportedLocale> {
  await clearCachedLocale();
  const detected = detectDeviceLocale();
  if (i18n.language !== detected) await i18n.changeLanguage(detected);
  return detected;
}

export default i18n;
