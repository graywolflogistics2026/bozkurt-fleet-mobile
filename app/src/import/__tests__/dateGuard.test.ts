import { trySwapYearAndDay, correctImplausibleDate, sanitizeExtractionDates, isOlderThanMonths } from '@/src/import/dateGuard';
import type { Extraction } from '@/src/import/types';

const NOW = new Date('2026-07-30T00:00:00Z');

describe('trySwapYearAndDay', () => {
  it('swaps year and day within the same century, month untouched (the reported bug)', () => {
    expect(trySwapYearAndDay('2024-07-26')).toBe('2026-07-24');
  });

  it('is its own inverse for a round-trippable pair', () => {
    expect(trySwapYearAndDay('2026-07-24')).toBe('2024-07-26');
  });

  it('returns null when the resulting "day" (old year mod 100) is not a valid day-of-month', () => {
    // year 2098 -> swapped day would be 98, not a real day.
    expect(trySwapYearAndDay('2098-05-12')).toBeNull();
  });

  it('returns null when the swap does not form a real calendar date', () => {
    // day=31 (from old year 2031 mod 100) in a 30-day month (April).
    expect(trySwapYearAndDay('2031-04-30')).toBeNull();
  });

  it('returns null for a non-ISO-date string', () => {
    expect(trySwapYearAndDay('07/26/2024')).toBeNull();
  });
});

describe('correctImplausibleDate (DATE HARDENING round 2)', () => {
  it('corrects the exact reported bug: 2024-07-26 (year/day swapped from 26/07/24) -> 2026-07-24', () => {
    expect(correctImplausibleDate('2024-07-26', NOW)).toBe('2026-07-24');
  });

  it('leaves a plausible recent date untouched', () => {
    expect(correctImplausibleDate('2026-07-15', NOW)).toBe('2026-07-15');
  });

  it('leaves a date within the 13-month window untouched even though it is "old"', () => {
    // ~7 months before NOW.
    expect(correctImplausibleDate('2025-12-30', NOW)).toBe('2025-12-30');
  });

  it('leaves a genuinely old date untouched when its swap does NOT land near today', () => {
    // 2020-03-10 swapped -> 2010-03-20, itself ancient — no plausible
    // alternate reading, so the original (if implausible either way) is
    // left for the human to confirm/fix in the preview, never guessed.
    expect(correctImplausibleDate('2020-03-10', NOW)).toBe('2020-03-10');
  });

  it('leaves a date untouched when the swap is not a valid calendar date at all', () => {
    expect(correctImplausibleDate('2098-05-12', NOW)).toBe('2098-05-12');
  });

  it('passes through null/undefined unchanged', () => {
    expect(correctImplausibleDate(null, NOW)).toBeNull();
    expect(correctImplausibleDate(undefined, NOW)).toBeNull();
  });

  it('tolerates a swapped date up to 1 month in the future (near-future scanning/clock skew)', () => {
    // NOW=2026-07-30; a swap landing 2026-08-20 (~3 weeks out) should be accepted.
    // Construct: original stale date whose swap = 2026-08-20 -> year=2020,day=26? let's
    // just pick original '2020-08-26' -> swap: century=2000, swappedYear=2000+26=2026,
    // swappedDay=2020%100=20 -> '2026-08-20'.
    expect(correctImplausibleDate('2020-08-26', NOW)).toBe('2026-08-20');
  });
});

describe('sanitizeExtractionDates', () => {
  it('corrects the top-level date and settlement.weekEnding', () => {
    const extraction: Extraction = { docType: 'settlement', date: '2024-07-26', settlement: { weekEnding: '2024-07-26' } };
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.date).toBe('2026-07-24');
    expect(result.settlement?.weekEnding).toBe('2026-07-24');
  });

  it('corrects nested load/fuel/toll dates', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        loads: [{ pickupDate: '2024-07-26', deliveryDate: '2024-07-26', date: '2024-07-26', dropDate: '2024-07-26' }],
        tractorFuel: [{ date: '2024-07-26' }],
        reeferFuel: [{ date: '2024-07-26' }],
        tolls: { ezpass: { items: [{ date: '2024-07-26' }] }, drivewyze: { items: [{ date: '2024-07-26' }] } },
      },
    };
    const result = sanitizeExtractionDates(extraction, NOW);
    const load = result.settlement!.loads![0];
    expect(load.pickupDate).toBe('2026-07-24');
    expect(load.deliveryDate).toBe('2026-07-24');
    expect(load.date).toBe('2026-07-24');
    expect(load.dropDate).toBe('2026-07-24');
    expect(result.settlement!.tractorFuel![0].date).toBe('2026-07-24');
    expect(result.settlement!.reeferFuel![0].date).toBe('2026-07-24');
    expect(result.settlement!.tolls!.ezpass!.items![0].date).toBe('2026-07-24');
    expect(result.settlement!.tolls!.drivewyze!.items![0].date).toBe('2026-07-24');
  });

  it('corrects compliance.issueDate (a past document date) but NEVER touches compliance.dueDate (forward-looking)', () => {
    const extraction: Extraction = {
      docType: 'insurance_policy',
      compliance: { issueDate: '2024-07-26', dueDate: '2024-07-26' },
    };
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.compliance?.issueDate).toBe('2026-07-24');
    expect(result.compliance?.dueDate).toBe('2024-07-26'); // untouched — it's a future due date, not a document date
  });

  it('never touches a loan nextDue field (forward-looking, not a document date)', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: { loans: [{ name: 'Truck loan', nextDue: '2024-07-26' }] },
    };
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.settlement?.loans?.[0].nextDue).toBe('2024-07-26');
  });

  it('is a no-op when there are no dates to sanitize', () => {
    const extraction: Extraction = { docType: 'other' };
    expect(sanitizeExtractionDates(extraction, NOW)).toEqual(extraction);
  });
});

describe('isOlderThanMonths (import preview "Is this date correct?" highlight)', () => {
  it('is true for a date more than N months before now', () => {
    expect(isOlderThanMonths('2025-12-01', 6, NOW)).toBe(true);
  });

  it('is false for a date within the last N months', () => {
    expect(isOlderThanMonths('2026-07-01', 6, NOW)).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isOlderThanMonths(null, 6, NOW)).toBe(false);
    expect(isOlderThanMonths(undefined, 6, NOW)).toBe(false);
  });
});
