// Supported languages (owner decision 2026-07-09, PRODUCT DECISION — binding).
// en.json is the source of truth: every new user-facing string is added
// there first, then translated into the other four.
export const SUPPORTED_LOCALES = ['en', 'es', 'ru', 'ar', 'tr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  ar: 'العربية',
  tr: 'Türkçe',
};

// Arabic is the only RTL language in the supported set today.
const RTL_LOCALES: readonly SupportedLocale[] = ['ar'];

export function isSupportedLocale(code: string | null | undefined): code is SupportedLocale {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

export function isRTLLocale(locale: SupportedLocale): boolean {
  return RTL_LOCALES.includes(locale);
}
