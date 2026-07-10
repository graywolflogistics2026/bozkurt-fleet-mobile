import { useTranslation } from 'react-i18next';

// Locale-aware formatting (owner decision 2026-07-10, PRODUCT DECISION,
// CLAUDE.md invariant): dates, currency, and number formatting follow the
// app's selected locale everywhere — USD stays the CURRENCY (this app
// never converts amounts to another currency), only its FORMATTING
// (symbol position, decimal/thousands separators, digit script) localizes
// via the Intl APIs `toLocaleString()` already wraps. Plain functions take
// an explicit locale (for non-component call sites, e.g.
// app/(tabs)/import/index.tsx's buildPreviewLines()); useFormatters() below
// is the hook form bound to the app's current i18n locale for use inside
// components.
export function formatMoney(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(locale, { style: 'currency', currency: 'USD', ...options });
}

export function formatNumber(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(locale, options);
}

export function formatDate(d: string | number | Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleDateString(locale, options);
}

export function formatDateTime(d: string | number | Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleString(locale, options);
}

export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return {
    money: (n: number, options?: Intl.NumberFormatOptions) => formatMoney(n, locale, options),
    number: (n: number, options?: Intl.NumberFormatOptions) => formatNumber(n, locale, options),
    date: (d: string | number | Date, options?: Intl.DateTimeFormatOptions) => formatDate(d, locale, options),
    dateTime: (d: string | number | Date, options?: Intl.DateTimeFormatOptions) => formatDateTime(d, locale, options),
  };
}
