import { formatMoney, formatNumber, formatDate, formatDateTime, formatMonthLabel } from '@/src/i18n/format';

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

describe('formatMonthLabel (MONTH FILTER OFF-BY-ONE fix, owner decision) — the same class of bug formatDate\'s own tolerant regex above already hints at, but not tolerated here', () => {
  it('every one of the 12 months produces its OWN correct name, never the previous month\'s', () => {
    const expected = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    for (let month = 1; month <= 12; month++) {
      expect(formatMonthLabel(2026, month, 'en', { month: 'long' })).toBe(expected[month - 1]);
    }
  });

  it('is immune to the UTC-midnight-vs-local-timezone rollback that broke the old `date(\`${y}-${m}-01\`, ...)` pattern, swept across timezones on BOTH sides of UTC', () => {
    // The old buggy pattern (new Date('2026-05-01') parsed as UTC midnight,
    // then .toLocaleDateString() rendered in local time) reads "Apr" for
    // May in any timezone behind UTC — reproduced directly below to prove
    // this test would have caught the original bug, not just asserted
    // behavior the fix already guarantees. formatMonthLabel() constructs
    // the Date via the LOCAL-time constructor instead, so it can never
    // roll back regardless of the runtime's own timezone.
    const originalTz = process.env.TZ;
    try {
      for (const tz of ['Pacific/Honolulu', 'America/Chicago', 'UTC', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(formatMonthLabel(2026, 5, 'en', { month: 'short' })).toBe('May');
        expect(formatMonthLabel(2026, 6, 'en', { month: 'short' })).toBe('Jun');
      }

      // Proves the OLD pattern genuinely broke under a behind-UTC timezone
      // (the exact device-reported symptom) — the fix's own job is making
      // this discrepancy impossible, confirmed above.
      process.env.TZ = 'Pacific/Honolulu';
      const oldBuggyLabel = new Date('2026-05-01').toLocaleDateString('en', { month: 'short' });
      expect(oldBuggyLabel).toBe('Apr');
      expect(oldBuggyLabel).not.toBe(formatMonthLabel(2026, 5, 'en', { month: 'short' }));
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('a full year+month label reads correctly (the Accountant Package header\'s own use)', () => {
    expect(formatMonthLabel(2026, 5, 'en', { year: 'numeric', month: 'long' })).toBe('May 2026');
  });

  it('does not throw for any supported locale', () => {
    for (const locale of ['en', 'es', 'ru', 'ar', 'tr', 'hi', 'uk']) {
      expect(() => formatMonthLabel(2026, 1, locale, { month: 'long' })).not.toThrow();
    }
  });
});
