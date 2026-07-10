import { formatMoney, formatNumber, formatDate, formatDateTime } from '@/src/i18n/format';

describe('formatMoney (owner decision 2026-07-10 — locale-aware formatting, CLAUDE.md invariant #15)', () => {
  it('formats USD for en-US with the $ symbol before the amount', () => {
    expect(formatMoney(1234.5, 'en')).toBe('$1,234.50');
  });

  it('keeps USD as the currency for a non-English locale, only the formatting changes', () => {
    // es uses a period for thousands and a comma for decimals; the currency
    // stays USD (this app never converts to another currency).
    const formatted = formatMoney(1234.5, 'es');
    expect(formatted).toContain('1234,50');
    expect(formatted).toMatch(/US\$|\$/);
  });

  it('accepts an options override (e.g. 0 fraction digits for the Dashboard)', () => {
    expect(formatMoney(1234.5, 'en', { maximumFractionDigits: 0 })).toBe('$1,235');
  });
});

describe('formatNumber', () => {
  it('formats a plain number with locale-appropriate grouping', () => {
    expect(formatNumber(12345, 'en')).toBe('12,345');
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats a date string using the given locale', () => {
    // en-US month/day/year order
    expect(formatDate('2026-03-05T00:00:00Z', 'en')).toMatch(/3\/(4|5)\/2026/);
  });

  it('formatDateTime does not throw for any supported locale', () => {
    for (const locale of ['en', 'es', 'ru', 'ar', 'tr', 'hi', 'uk']) {
      expect(() => formatDateTime('2026-03-05T12:00:00Z', locale)).not.toThrow();
    }
  });
});
