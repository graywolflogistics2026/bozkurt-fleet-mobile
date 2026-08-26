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

// MONTH FILTER OFF-BY-ONE (owner decision, device report) — root cause:
// a date-only ISO string ("YYYY-MM-DD", no time component) is parsed by
// `new Date(string)` as UTC MIDNIGHT (per the ECMAScript spec — this is
// specific to the date-only form; a date-TIME string with no offset
// parses as LOCAL time instead), but `.toLocaleDateString()` always
// renders in the LOCAL timezone. For any device timezone BEHIND UTC
// (true of the entire Western Hemisphere, where this app's own users
// are), that mismatch rolls the displayed calendar day back by one —
// May 1st UTC midnight reads as "Apr 30" in, say, US Eastern time. Every
// month-LABEL in this app that was built by constructing a "YYYY-MM-01"
// string (or a `Date.UTC(...)` value re-serialized back to one) and
// feeding it through `formatDate()`/`date()` hit this exact bug — most
// visibly, the Accountant Package's own Month pill row showed each
// button's label one calendar month EARLIER than the numeric value that
// button's own `onPress` actually set, so tapping the pill labeled "May"
// silently selected month 6 (June) instead.
//
// `formatMonthLabel()` is the fix: it constructs the `Date` using the
// LOCAL-time constructor (`new Date(year, monthIndex, day)`, unambiguous
// by spec — its arguments are always interpreted as local calendar
// components, never UTC) instead of round-tripping through an ISO
// STRING — so construction and `.toLocaleDateString()`'s own formatting
// both happen in the exact same timezone, with no UTC-vs-local seam left
// for a rollback to hide in. This is the ONE function every month-only
// label in this app must go through from now on — never
// `date(`${y}-${m}-01`, ...)` or `date(new Date(Date.UTC(y, m-1, 1))...
// .toISOString()..., ...)` again.
export function formatMonthLabel(year: number, month1Based: number, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(year, month1Based - 1, 1).toLocaleDateString(locale, options);
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
    monthLabel: (year: number, month1Based: number, options?: Intl.DateTimeFormatOptions) => formatMonthLabel(year, month1Based, locale, options),
  };
}
