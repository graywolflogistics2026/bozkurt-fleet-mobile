import { resolveWeeklyMiles, sanitizeExtractionMiles } from '@/src/import/milesGuard';
import type { Extraction } from '@/src/import/types';

// MILES TRAP (owner decision 2026-08-02, CRITICAL BUG FIX — verified
// against a real statement: a "LTD MILES" (lifetime-to-date) figure was
// extracted as this week's totalMiles for a settlement with zero loads).
describe('resolveWeeklyMiles', () => {
  it('corrects a nonzero miles figure to 0 when there are no loads this week (a home week)', () => {
    // The exact reported bug: 0 loads, but a large lifetime-miles number
    // was extracted as totalMiles.
    const result = resolveWeeklyMiles(87432, []);
    expect(result).toEqual({ miles: 0, flagged: false });
  });

  it('leaves a genuine 0 miles / no loads week untouched', () => {
    expect(resolveWeeklyMiles(0, [])).toEqual({ miles: 0, flagged: false });
  });

  it('leaves a plausible miles figure untouched when it roughly matches the loads', () => {
    const loads = [{ loadedMiles: 500, emptyMiles: 50 }, { loadedMiles: 400, emptyMiles: 20 }];
    // sum = 970; 1000 is well within the 1.5x tolerance.
    expect(resolveWeeklyMiles(1000, loads)).toEqual({ miles: 1000, flagged: false });
  });

  it('uses the sum of load miles and flags for review when totalMiles is implausibly larger', () => {
    const loads = [{ loadedMiles: 500, emptyMiles: 50 }, { loadedMiles: 400, emptyMiles: 20 }];
    // sum = 970; a lifetime figure like 45000 is way past the 1.5x tolerance.
    const result = resolveWeeklyMiles(45000, loads);
    expect(result).toEqual({ miles: 970, flagged: true });
  });

  it('does not touch totalMiles when loads exist but carry no mileage data of their own', () => {
    const loads = [{ loadedMiles: 0, emptyMiles: 0 }];
    expect(resolveWeeklyMiles(1200, loads)).toEqual({ miles: 1200, flagged: false });
  });

  it('treats a missing/null totalMiles as 0', () => {
    expect(resolveWeeklyMiles(null, [])).toEqual({ miles: 0, flagged: false });
    expect(resolveWeeklyMiles(undefined, [])).toEqual({ miles: 0, flagged: false });
  });

  it('ignores negative loadedMiles/emptyMiles rather than letting them cancel out a real total', () => {
    const loads = [{ loadedMiles: -500, emptyMiles: 100 }];
    // sum should floor negative contributions to 0, so loadMilesSum = 100.
    const result = resolveWeeklyMiles(1000, loads);
    expect(result).toEqual({ miles: 100, flagged: true });
  });
});

function settlementExtraction(overrides: Partial<NonNullable<Extraction['settlement']>>): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: '2026-07-24',
      grossRevenue: 5.16,
      netPay: -1155.35,
      totalMiles: 87432,
      loads: [],
      ...overrides,
    },
  };
}

describe('sanitizeExtractionMiles', () => {
  it('corrects settlement.totalMiles to 0 for a real 0-load statement with an LTD-miles trap', () => {
    const extraction = settlementExtraction({});
    const sanitized = sanitizeExtractionMiles(extraction);
    expect(sanitized.settlement?.totalMiles).toBe(0);
    // Rule 1 (no loads) never downgrades confidence — it's unambiguous.
    expect(sanitized.confidence).toBeUndefined();
  });

  it('downgrades confidence to low when the load-miles-sum correction (rule 2) fires', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      confidence: 'high',
      settlement: {
        weekEnding: '2026-07-24',
        totalMiles: 45000,
        loads: [{ order: 'L1', loadedMiles: 500, emptyMiles: 50 }],
      },
    };
    const sanitized = sanitizeExtractionMiles(extraction);
    expect(sanitized.settlement?.totalMiles).toBe(550);
    expect(sanitized.confidence).toBe('low');
  });

  it('leaves a plausible extraction completely untouched (same object reference)', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      confidence: 'high',
      settlement: { weekEnding: '2026-07-24', totalMiles: 1000, loads: [{ order: 'L1', loadedMiles: 600, emptyMiles: 100 }] },
    };
    const sanitized = sanitizeExtractionMiles(extraction);
    expect(sanitized).toBe(extraction);
  });

  it('passes through non-settlement docTypes untouched', () => {
    const extraction: Extraction = { docType: 'fuel' };
    expect(sanitizeExtractionMiles(extraction)).toBe(extraction);
  });
});
