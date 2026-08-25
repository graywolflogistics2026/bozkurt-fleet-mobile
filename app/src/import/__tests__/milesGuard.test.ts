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

  // RULE 3 — NULL MUST NEVER BEAT A NUMBER (owner decision 2026-08-24,
  // MILES READ BUT NOT USED fix). The mirror-image of the LTD-miles trap
  // above: real loads exist with real mileage, but totalMiles came back
  // implausibly SMALL (most commonly exactly 0/missing — e.g. a header
  // scalar the model didn't see, or a multi-page merge's own "chunk[0]
  // priority" rule for this field never seeing the page that had it).
  describe('rule 3 — totalMiles implausibly smaller than the real loads sum', () => {
    it('the exact reported case: totalMiles came back 0 while loads sum to 10,146 real miles', () => {
      const loads = [
        { loadedMiles: 6200, emptyMiles: 800 },
        { loadedMiles: 2600, emptyMiles: 546 },
      ];
      // sum = 10146.
      const result = resolveWeeklyMiles(0, loads);
      expect(result).toEqual({ miles: 10146, flagged: true });
    });

    it('also fires when totalMiles is missing/undefined entirely, not just literally 0', () => {
      const loads = [{ loadedMiles: 6200, emptyMiles: 800 }, { loadedMiles: 2600, emptyMiles: 546 }];
      expect(resolveWeeklyMiles(undefined, loads)).toEqual({ miles: 10146, flagged: true });
      expect(resolveWeeklyMiles(null, loads)).toEqual({ miles: 10146, flagged: true });
    });

    it('fires for any totalMiles genuinely smaller than the loads sum, not only exactly 0', () => {
      const loads = [{ loadedMiles: 6200, emptyMiles: 800 }, { loadedMiles: 2600, emptyMiles: 546 }];
      // A partial/truncated read of totalMiles (e.g. 500) is still less
      // than the real 10146 the loads add up to.
      const result = resolveWeeklyMiles(500, loads);
      expect(result).toEqual({ miles: 10146, flagged: true });
    });

    it('does NOT fire when totalMiles exactly matches the loads sum (nothing to correct)', () => {
      const loads = [{ loadedMiles: 600, emptyMiles: 100 }];
      expect(resolveWeeklyMiles(700, loads)).toEqual({ miles: 700, flagged: false });
    });

    it('does NOT fire when totalMiles is plausibly larger than the loads sum (real deadhead not tied to a load)', () => {
      const loads = [{ loadedMiles: 600, emptyMiles: 100 }];
      // 900 > 700 (loads sum) but well within the 1.5x trap ratio — a
      // real, legitimate total, not an error.
      expect(resolveWeeklyMiles(900, loads)).toEqual({ miles: 900, flagged: false });
    });
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

  // MILES READ BUT NOT USED (owner decision 2026-08-24) — the exact
  // reported real-world shape: totalMiles lost upstream (0/missing) while
  // the loads array (correctly concatenated across pages by the server's
  // own merge) still carries the real 10,146 miles.
  it('recovers a real totalMiles from the loads sum when the extracted total came back 0', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      confidence: 'high',
      settlement: {
        weekEnding: '2026-07-24',
        totalMiles: 0,
        loads: [
          { order: 'L1', loadedMiles: 6200, emptyMiles: 800 },
          { order: 'L2', loadedMiles: 2600, emptyMiles: 546 },
        ],
      },
    };
    const sanitized = sanitizeExtractionMiles(extraction);
    expect(sanitized.settlement?.totalMiles).toBe(10146);
    expect(sanitized.confidence).toBe('low');
  });
});
