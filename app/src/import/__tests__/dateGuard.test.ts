import {
  trySwapYearAndDay,
  correctImplausibleDate,
  sanitizeExtractionDates,
  isOlderThanMonths,
  isSettlementWeekEndingMissing,
  resolveWeekEndingWithAnchor,
  isImplausibleDate,
  findImplausibleDates,
  toDateOrNull,
} from '@/src/import/dateGuard';
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

// DATE HARDENING round 3 (owner decision 2026-07-30, CRITICAL BUG FIX): the
// AI must never invent a settlement weekEnding from today's date — when it
// genuinely can't read one, the import preview blocks Save until the user
// enters it themselves. This guard is what the Save button's `disabled`
// prop is keyed off of, mirroring the throw in aiImportSave.ts's
// saveExtraction() so the UI never reaches that throw.
// DATE ANCHOR (owner decision 2026-07-30, DEFINITIVE FIX — owner's own
// field diagnosis): both real examples the owner reported from an actual
// carrier statement, plus a no-fit case.
describe('resolveWeekEndingWithAnchor (DATE HARDENING round 4)', () => {
  it('example 1: printDate 2026-07-16 + "26/07/17" -> 2026-07-17 (not 2017-07-26)', () => {
    expect(resolveWeekEndingWithAnchor('2026-07-16', '2026-07-17')).toBe('2026-07-17');
  });

  it('example 1, swapped-reading input: printDate 2026-07-16 + the misread "2017-07-26" still resolves to 2026-07-17', () => {
    // If the AI had instead read the ambiguous SETTLEMENTS DATE the OTHER
    // way (year/day swapped), the anchor must still pull it back to the
    // correct reading rather than accepting the out-of-window guess.
    expect(resolveWeekEndingWithAnchor('2026-07-16', '2017-07-26')).toBe('2026-07-17');
  });

  it('example 2: printDate 2026-07-23 + "26/07/24" -> 2026-07-24', () => {
    expect(resolveWeekEndingWithAnchor('2026-07-23', '2026-07-24')).toBe('2026-07-24');
  });

  it('returns null when neither reading falls in the [printDate, printDate+7] window', () => {
    expect(resolveWeekEndingWithAnchor('2026-07-16', '2026-09-01')).toBeNull();
  });

  it('returns null when printDate is missing', () => {
    expect(resolveWeekEndingWithAnchor(null, '2026-07-17')).toBeNull();
    expect(resolveWeekEndingWithAnchor(undefined, '2026-07-17')).toBeNull();
  });

  it('returns null when the weekEnding candidate is missing', () => {
    expect(resolveWeekEndingWithAnchor('2026-07-16', null)).toBeNull();
  });

  it('accepts a reading exactly on the window boundary (printDate itself, and printDate+7)', () => {
    expect(resolveWeekEndingWithAnchor('2026-07-16', '2026-07-16')).toBe('2026-07-16');
    expect(resolveWeekEndingWithAnchor('2026-07-16', '2026-07-23')).toBe('2026-07-23');
  });
});

describe('sanitizeExtractionDates uses the date anchor when printDate is present', () => {
  it('resolves weekEnding via the anchor instead of the "now"-based correction', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: { weekEnding: '2026-07-17', printDate: '2026-07-16' },
    };
    // NOW is far from both dates — the "now"-based correction alone would
    // leave 2026-07-17 untouched anyway here, so this specifically proves
    // the anchor path is taken by checking the swapped-misread case below.
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.settlement?.weekEnding).toBe('2026-07-17');
  });

  it('pulls a swapped/misread weekEnding back to the anchor-correct reading', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: { weekEnding: '2017-07-26', printDate: '2026-07-16' },
    };
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.settlement?.weekEnding).toBe('2026-07-17');
  });

  it('falls back to the "now"-based correction when printDate is absent', () => {
    const extraction: Extraction = { docType: 'settlement', settlement: { weekEnding: '2024-07-26' } };
    const result = sanitizeExtractionDates(extraction, NOW);
    expect(result.settlement?.weekEnding).toBe('2026-07-24');
  });
});

describe('isSettlementWeekEndingMissing (DATE HARDENING round 3)', () => {
  it('is true for a settlement with no weekEnding at all', () => {
    expect(isSettlementWeekEndingMissing({ docType: 'settlement', settlement: {} })).toBe(true);
  });

  it('is true for a settlement with an empty-string weekEnding', () => {
    expect(isSettlementWeekEndingMissing({ docType: 'settlement', settlement: { weekEnding: '' } })).toBe(true);
  });

  it('is false once the user has confirmed a weekEnding', () => {
    expect(isSettlementWeekEndingMissing({ docType: 'settlement', settlement: { weekEnding: '2026-07-05' } })).toBe(false);
  });

  it('is false for every non-settlement docType regardless of date', () => {
    expect(isSettlementWeekEndingMissing({ docType: 'fuel' })).toBe(false);
    expect(isSettlementWeekEndingMissing({ docType: 'other' })).toBe(false);
  });
});

describe('isImplausibleDate (owner decision 2026-08-05, FULL PARITY pass item D.2)', () => {
  it('is false for a plausible recent date', () => {
    expect(isImplausibleDate('2026-07-18', NOW)).toBe(false);
  });

  it('is true for a date before 2020', () => {
    expect(isImplausibleDate('2017-07-26', NOW)).toBe(true);
  });

  it('is true for a date beyond next year', () => {
    expect(isImplausibleDate('2028-01-01', NOW)).toBe(true);
  });

  it('is false right at the boundary (next year itself is still plausible)', () => {
    expect(isImplausibleDate('2027-12-31', NOW)).toBe(false);
  });

  it('is false for null/undefined/non-ISO strings — not this function\'s concern', () => {
    expect(isImplausibleDate(null, NOW)).toBe(false);
    expect(isImplausibleDate(undefined, NOW)).toBe(false);
    expect(isImplausibleDate('not-a-date', NOW)).toBe(false);
  });
});

describe('findImplausibleDates (owner decision 2026-08-05, FULL PARITY pass item D.2)', () => {
  it('returns only the rows with an implausible date', () => {
    const rows = [
      { id: 'a', ded_date: '2026-07-18' },
      { id: 'b', ded_date: '2017-07-26' },
      { id: 'c', ded_date: null },
      { id: 'd', ded_date: '2099-01-01' },
    ];
    const result = findImplausibleDates(rows, (r) => r.ded_date, NOW);
    expect(result.map((r) => r.id)).toEqual(['b', 'd']);
  });

  it('returns an empty array when every date is plausible', () => {
    const rows = [{ id: 'a', ded_date: '2026-07-18' }];
    expect(findImplausibleDates(rows, (r) => r.ded_date, NOW)).toEqual([]);
  });
});

describe('toDateOrNull (owner decision 2026-08-05, IMPORT SAVE BUG FIX — device report: "invalid input syntax for type date: \\"\\"")', () => {
  it('passes through a valid YYYY-MM-DD date unchanged', () => {
    expect(toDateOrNull('2026-07-18')).toBe('2026-07-18');
  });

  it('returns null for an empty string — the exact bug: Postgres rejects "" for a date column', () => {
    expect(toDateOrNull('')).toBeNull();
  });

  it('returns null for whitespace-only text', () => {
    expect(toDateOrNull('   ')).toBeNull();
  });

  it('returns null for "N/A" or other non-calendar-date text', () => {
    expect(toDateOrNull('N/A')).toBeNull();
    expect(toDateOrNull('unknown')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
  });

  it('returns null for a malformed calendar date (e.g. month 13)', () => {
    expect(toDateOrNull('2026-13-45')).toBeNull();
  });

  it('trims surrounding whitespace around an otherwise-valid date', () => {
    expect(toDateOrNull('  2026-07-18  ')).toBe('2026-07-18');
  });
});
