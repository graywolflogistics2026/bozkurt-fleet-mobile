import {
  SUPPORTED_LOCALES,
  ENABLED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  isSupportedLocale,
  isEnabledLocale,
  isRTLLocale,
} from '@/src/i18n/config';

// LANGUAGE PICKER — FIVE LANGUAGES AT LAUNCH (owner decision) — direct,
// dedicated coverage for the core distinction this whole pass is built on:
// SUPPORTED (all 7, infrastructure/parity-test scope) vs. ENABLED (the 5
// actually selectable at launch) are two different sets, and every
// selection/detection surface must key off ENABLED, never SUPPORTED.
describe('i18n config — SUPPORTED vs ENABLED locales', () => {
  it('SUPPORTED_LOCALES still lists all 7 — nothing was deleted', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['ar', 'en', 'es', 'hi', 'ru', 'tr', 'uk'].sort());
  });

  it('ENABLED_LOCALES is exactly the 5 launch languages — ar/uk excluded', () => {
    expect([...ENABLED_LOCALES].sort()).toEqual(['en', 'es', 'hi', 'ru', 'tr'].sort());
    expect(ENABLED_LOCALES).not.toContain('ar');
    expect(ENABLED_LOCALES).not.toContain('uk');
  });

  it('every ENABLED locale is also a SUPPORTED locale (ENABLED is a subset)', () => {
    for (const locale of ENABLED_LOCALES) {
      expect(SUPPORTED_LOCALES).toContain(locale);
    }
  });

  it('DEFAULT_LOCALE is English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('LOCALE_LABELS covers all 7 locales, each in its own script/name (never translated)', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
    // Own-script spot checks — these must never be translated strings.
    expect(LOCALE_LABELS.en).toBe('English');
    expect(LOCALE_LABELS.es).toBe('Español');
    expect(LOCALE_LABELS.ru).toBe('Русский');
    expect(LOCALE_LABELS.tr).toBe('Türkçe');
    expect(LOCALE_LABELS.hi).toBe('हिन्दी');
    expect(LOCALE_LABELS.ar).toBe('العربية');
    expect(LOCALE_LABELS.uk).toBe('Українська');
  });

  describe('isSupportedLocale — recognizes all 7, including disabled ones', () => {
    it('returns true for every one of the 7, including disabled ar/uk', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(isSupportedLocale(locale)).toBe(true);
      }
    });
    it('returns false for an unknown code, null, undefined, or empty string', () => {
      expect(isSupportedLocale('fr')).toBe(false);
      expect(isSupportedLocale(null)).toBe(false);
      expect(isSupportedLocale(undefined)).toBe(false);
      expect(isSupportedLocale('')).toBe(false);
    });
  });

  describe('isEnabledLocale — the stricter, launch-scoped gate every selection/detection surface must use', () => {
    it('returns true only for the 5 enabled locales', () => {
      for (const locale of ENABLED_LOCALES) {
        expect(isEnabledLocale(locale)).toBe(true);
      }
    });
    it('returns false for a supported-but-disabled locale (ar, uk) — the core regression this pass exists to guard', () => {
      expect(isEnabledLocale('ar')).toBe(false);
      expect(isEnabledLocale('uk')).toBe(false);
    });
    it('returns false for an unknown code, null, undefined, or empty string', () => {
      expect(isEnabledLocale('fr')).toBe(false);
      expect(isEnabledLocale(null)).toBe(false);
      expect(isEnabledLocale(undefined)).toBe(false);
      expect(isEnabledLocale('')).toBe(false);
    });
  });

  describe('isRTLLocale', () => {
    it('Arabic is the only RTL locale', () => {
      expect(isRTLLocale('ar')).toBe(true);
      for (const locale of SUPPORTED_LOCALES) {
        if (locale === 'ar') continue;
        expect(isRTLLocale(locale)).toBe(false);
      }
    });
    it('the only RTL locale is currently disabled — no RTL surface ships in v1', () => {
      expect(isEnabledLocale('ar')).toBe(false);
      // every ENABLED locale is therefore LTR
      for (const locale of ENABLED_LOCALES) {
        expect(isRTLLocale(locale)).toBe(false);
      }
    });
  });
});
