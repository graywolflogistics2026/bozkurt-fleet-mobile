// Supported languages (owner decision 2026-07-09, PRODUCT DECISION — binding;
// Hindi/Ukrainian added 2026-07-09 addendum). en.json is the source of
// truth: every new user-facing string is added there first, then
// translated into the other six.
export const SUPPORTED_LOCALES = ['en', 'es', 'ru', 'ar', 'tr', 'hi', 'uk'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

// LANGUAGE PICKER — FIVE LANGUAGES AT LAUNCH (owner decision, supersedes the
// earlier 2026-07-26 "English-only at launch" LAUNCH SCOPE decision below).
// ENABLED_LOCALES is the subset of SUPPORTED_LOCALES actually selectable —
// on the first-run language screen, in Settings > Language, and for
// device-locale auto-detect. Everything else in this module (the full
// 7-locale SUPPORTED_LOCALES list, every locale JSON file including
// ar.json/uk.json, the glossary/key-parity test, and rtl.ts's RTL
// groundwork) stays fully intact and unmodified — re-enabling ar/uk later
// is a one-line array edit, never a rebuild or a redone translation pass.
//
// Arabic and Ukrainian are DISABLED for v1, not deleted. Arabic being
// disabled has a second consequence worth stating plainly: Arabic is the
// ONLY RTL locale in this app's supported set (see RTL_LOCALES below), so
// with it disabled, NO RTL SURFACE SHIPS IN v1 — nobody should assume RTL
// layout has been exercised on a real device just because the groundwork
// (isRTLLocale(), applyLocaleDirection(), the logical-style-property
// convention) already exists in the codebase. RTL only becomes a real,
// user-reachable code path again once 'ar' is added back to this array.
//
// (Historical note, superseded: the previous LAUNCH SCOPE decision —
// 2026-07-26 — shipped the very first beta/store release English-only via
// a single `LANGUAGE_PICKER_ENABLED = false` boolean that hid the Settings
// picker entirely and disabled device-language auto-detect. That flag has
// been replaced by this per-locale array now that Session 9c's real
// translation work has actually landed for 5 of the 7 languages.)
export const ENABLED_LOCALES: readonly SupportedLocale[] = ['en', 'es', 'ru', 'tr', 'hi'];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  ar: 'العربية',
  tr: 'Türkçe',
  hi: 'हिन्दी',
  uk: 'Українська',
};

// Arabic is the only RTL language in the supported set today — and it's
// disabled for v1 (see ENABLED_LOCALES above), so isRTLLocale() currently
// has no reachable `true` result anywhere a real user's own locale choice
// could produce, by construction.
const RTL_LOCALES: readonly SupportedLocale[] = ['ar'];

// "Is this a real locale this app's i18n resources know about at all" —
// used for validating raw, potentially-stale data (a cached AsyncStorage
// value, profiles.locale from the server) into the full SupportedLocale
// type. This intentionally still recognizes all 7 — a value that used to
// be valid (e.g. a locale later disabled) should be recognized as a real,
// well-typed SupportedLocale by this function; isEnabledLocale() below is
// the separate, narrower check for "is this actually selectable/usable
// right now."
export function isSupportedLocale(code: string | null | undefined): code is SupportedLocale {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

// "Is this one of the locales actually shipping at launch" — the gate
// every selection/detection surface (the first-run language screen,
// Settings > Language, device-locale auto-detect, the cached-locale
// reader, the profile-locale sync on sign-in) uses. Deliberately stricter
// than isSupportedLocale(): a locale that's supported-but-disabled (ar,
// uk) must never be silently activated just because it shows up in stale
// cached/server data — falling back to detection/English instead.
export function isEnabledLocale(code: string | null | undefined): code is SupportedLocale {
  return !!code && (ENABLED_LOCALES as readonly string[]).includes(code);
}

export function isRTLLocale(locale: SupportedLocale): boolean {
  return RTL_LOCALES.includes(locale);
}
