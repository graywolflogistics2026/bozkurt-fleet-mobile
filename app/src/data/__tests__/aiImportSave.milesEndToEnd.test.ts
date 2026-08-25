// MILES READ BUT NOT USED (owner decision 2026-08-24, device report: "the
// import screen says 'using settlement total 10,146' — so the value IS
// extracted — yet Home still shows 'no miles recorded' and CPM/RPM/PPM
// stay uncomputed"). Root cause: Home's dashboard trio queried
// useFleetStats(activeTruck?.id ?? null) — TRUCK-SCOPED — while every
// other canonical CPM/RPM/PPM consumer (Scorecard, Settlements' own
// fleet-wide stat row) queries useFleetStats(null) — FLEET-WIDE. A
// settlement whose own truck_id doesn't match activeTruck.id (most
// commonly one imported before any truck existed in the account yet —
// truckMatch.ts's resolveTruckMatch() silently saves truck_id: null when
// trucks.length === 0, no picker forced) was excluded from the
// truck-scoped read while still correctly included fleet-wide. Fixed by
// making Home use useFleetStats(null) too (app/(tabs)/index.tsx) — this
// test proves the ACTUAL VALUE ITSELF was never lost anywhere in the
// extraction -> mapping -> save -> calcMiles chain, which is what makes
// that root-cause diagnosis correct rather than a guess: it exercises the
// REAL saveExtraction() path against the fake Supabase client with a real
// settlement payload carrying totalMiles: 10146, then feeds the ACTUAL
// saved row through the ACTUAL canonical calcMiles()/calcCanonicalCpm()
// every screen reads from.
import type { Extraction } from '@/src/import/types';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array();
    }
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { saveExtraction } from '@/src/data/aiImportSave';
import { sanitizeExtractionMiles } from '@/src/import/milesGuard';
import { calcMiles } from '@/src/stats/miles';
import { calcCanonicalCpm } from '@/src/stats/cpm';
import type { Deduction, Settlement } from '@/src/types/db';

const USER_ID = 'user-1';
const WEEK_ENDING = '2026-07-26';
const REAL_TOTAL_MILES = 10146;

// A realistic settlement: totalMiles printed on the header, AND a loads
// breakdown that plausibly accounts for it (loadedMiles 9800 + emptyMiles
// 346 = 10146) — matching totalMiles exactly, so the miles guard (rule 2
// "implausibly large" / rule 3 "implausibly small") has nothing to
// correct and leaves the real value untouched, same as a real, clean
// extraction would.
function realSettlementExtraction(): Extraction {
  const raw: Extraction = {
    docType: 'settlement',
    settlement: {
      weekEnding: WEEK_ENDING,
      grossRevenue: 8500,
      netPay: 6800,
      totalMiles: REAL_TOTAL_MILES,
      loads: [
        { order: 'L1', from: 'Dallas, TX', to: 'Chicago, IL', loadedMiles: 9800, emptyMiles: 346, revenue: 8500 },
      ],
      deductions: [{ code: 'INS', desc: 'Weekly insurance', amount: 150 }],
    },
  };
  // Every real import runs the raw extraction through this guard
  // (src/data/aiImportCall.ts) before it ever reaches mapSettlement()/
  // saveExtraction() — applied here too so this test proves the FULL real
  // pipeline end to end, not a shortcut around one of its steps.
  return sanitizeExtractionMiles(raw);
}

function baseParams(extraction: Extraction) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution: false,
  };
}

beforeEach(() => {
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 0 }],
  });
});

describe('MILES READ BUT NOT USED — end-to-end: extraction -> guard -> save -> calcMiles -> CPM/RPM/PPM', () => {
  test('the guard leaves a real, plausible totalMiles completely untouched before save', () => {
    const extraction = realSettlementExtraction();
    expect(extraction.settlement?.totalMiles).toBe(REAL_TOTAL_MILES);
  });

  test('after save, the settlement row in the database has 10146, not 0/null/a string', async () => {
    await saveExtraction(baseParams(realSettlementExtraction()));
    const settlements = mockClient.__store.settlements as Settlement[];
    expect(settlements).toHaveLength(1);
    expect(settlements[0].miles).toBe(REAL_TOTAL_MILES);
    expect(typeof settlements[0].miles).toBe('number');
  });

  test('calcMiles() — the one canonical miles reader every screen uses — returns the real total from the saved row', async () => {
    await saveExtraction(baseParams(realSettlementExtraction()));
    const settlements = mockClient.__store.settlements as Settlement[];
    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(REAL_TOTAL_MILES);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].totalMiles).toBe(REAL_TOTAL_MILES);
  });

  test('CPM/RPM/PPM all compute as real numbers (never null) from the saved settlement — exactly what Home/Scorecard/the CPM "Why?" breakdown read', async () => {
    await saveExtraction(baseParams(realSettlementExtraction()));
    const settlements = mockClient.__store.settlements as Settlement[];
    const deductions = mockClient.__store.deductions as Deduction[];
    const milesResult = calcMiles(settlements, []);

    // Same shared function Home/Scorecard/the CPM "Why?" breakdown all
    // call — never a screen-local reimplementation.
    const cpm = calcCanonicalCpm(settlements[0].gross, milesResult.totalMiles, deductions, [], [], []);
    expect(cpm.revenuePerMile).not.toBeNull();
    expect(cpm.costPerMile).not.toBeNull();
    expect(cpm.profitPerMile).not.toBeNull();
    expect(cpm.revenuePerMile).toBeCloseTo(settlements[0].gross / REAL_TOTAL_MILES, 5);
  });

  // GUARD-RECOVERY CASE: even when the raw extraction lost totalMiles
  // upstream (e.g. a multi-page merge's own chunk[0]-priority rule for
  // this exact field — see chunking.test.ts's own coverage of that), the
  // guard recovers it from a real loads breakdown BEFORE saveExtraction()
  // ever sees it — proving the value "survives the guard" all the way
  // through an actual save, not just in the guard's own isolated tests.
  test('even when totalMiles came back 0 upstream, the guard-corrected value is what actually gets saved', async () => {
    const lostUpstream: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: WEEK_ENDING,
        grossRevenue: 8500,
        netPay: 6800,
        totalMiles: 0, // lost upstream — the real value only lives in loads below
        loads: [
          { order: 'L1', from: 'Dallas, TX', to: 'Chicago, IL', loadedMiles: 9800, emptyMiles: 346, revenue: 8500 },
        ],
        deductions: [{ code: 'INS', desc: 'Weekly insurance', amount: 150 }],
      },
    };
    const guarded = sanitizeExtractionMiles(lostUpstream);
    expect(guarded.settlement?.totalMiles).toBe(REAL_TOTAL_MILES);

    await saveExtraction(baseParams(guarded));
    const settlements = mockClient.__store.settlements as Settlement[];
    expect(settlements[0].miles).toBe(REAL_TOTAL_MILES);

    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(REAL_TOTAL_MILES);
  });
});
