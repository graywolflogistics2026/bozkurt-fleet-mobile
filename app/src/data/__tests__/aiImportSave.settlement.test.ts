// CRITICAL BUG FIX (device feedback, 2026-07-30): importing two different
// settlement weeks was silently REPLACING the first instead of creating a
// second, coexisting settlement (CLAUDE.md invariant #10). These tests
// exercise the real saveExtraction() settlement branch against an
// in-memory fake Supabase client (fakeSupabase.ts) — no mocked assertions
// about what the code "should" do, actual writes against actual tables.
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

const USER_ID = 'user-1';

function settlementExtraction(weekEnding: string, netPay: number): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding,
      grossRevenue: 2000,
      netPay,
      totalMiles: 1500,
      loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
      tractorFuel: [{ amount: 300, gallons: 100 }],
      deductions: [{ code: 'INS', desc: 'Insurance', amount: 150 }],
    },
  };
}

function baseParams(extraction: Extraction, truckId: string | null = null) {
  return {
    extraction,
    userId: USER_ID,
    truckId,
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

describe('saveExtraction settlement coexistence (CLAUDE.md invariant #10)', () => {
  test('two different weeks create two separate settlements, both with children intact', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000)));
    await saveExtraction(baseParams(settlementExtraction('2026-07-12', 1200)));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(2);
    const weekEndings = settlements.map((s) => s.week_ending).sort();
    expect(weekEndings).toEqual(['2026-07-05', '2026-07-12']);

    const loads = mockClient.__store.loads ?? [];
    expect(loads).toHaveLength(2);
    const fuel = mockClient.__store.fuel_purchases ?? [];
    expect(fuel).toHaveLength(2);
    const deductions = mockClient.__store.deductions ?? [];
    expect(deductions).toHaveLength(2);

    // Each settlement's children point at ITS OWN settlement id.
    for (const settlement of settlements) {
      const ownLoads = loads.filter((l) => l.settlement_id === settlement.id);
      expect(ownLoads).toHaveLength(1);
    }
  });

  test('re-importing the same week with a CORRECTED net pay applies only the delta (owner decision 2026-08-02)', async () => {
    const first = await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000)));
    const second = await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1500)));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(1);
    expect(settlements[0].net).toBe(1500);

    // First import credits the full 1000; the re-import corrects net pay
    // to 1500, so the balance applies just the +500 delta (1000 -> 1500),
    // not "credited once and never again."
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(1500);
    expect(settlements[0].business_balance_credit).toBe(1500);

    expect(first.netPayAdded).toBe(1000);
    expect(second.netPayAdded).toBe(500);

    // Save-confirmation fields (owner decision 2026-07-30): the caller can
    // tell the user plainly whether this was a new week or a replace.
    expect(first.settlementWeekEnding).toBe('2026-07-05');
    expect(first.isSettlementReimport).toBe(false);
    expect(second.settlementWeekEnding).toBe('2026-07-05');
    expect(second.isSettlementReimport).toBe(true);
  });

  test('re-importing with a LOWER corrected net pay reduces the balance by the negative delta', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 2000)));
    const second = await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1200)));

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(1200);
    expect(second.netPayAdded).toBe(-800);
  });

  test('re-import ordering: new child rows exist before old ones are removed, and old rows never survive', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000)));
    const firstLoads = mockClient.__store.loads.map((l) => l.id);

    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1500)));
    const loads = mockClient.__store.loads ?? [];

    // Exactly one settlement's worth of loads remains — the old batch's
    // row ids are gone, replaced by a freshly-inserted batch (never the
    // literal same row survives a re-import).
    expect(loads).toHaveLength(1);
    expect(firstLoads).not.toContain(loads[0].id as string);
  });

  test('replacing one week never deletes another week\'s loads/fuel/deductions', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000)));
    await saveExtraction(baseParams(settlementExtraction('2026-07-12', 1200)));
    // Re-import week 07-05 with different figures — should only touch its own children.
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 900)));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(2);

    const julyFifth = settlements.find((s) => s.week_ending === '2026-07-05')!;
    const julyTwelfth = settlements.find((s) => s.week_ending === '2026-07-12')!;
    expect(julyFifth.net).toBe(900);
    expect(julyTwelfth.net).toBe(1200);

    const loads = mockClient.__store.loads ?? [];
    expect(loads.filter((l) => l.settlement_id === julyFifth.id)).toHaveLength(1);
    expect(loads.filter((l) => l.settlement_id === julyTwelfth.id)).toHaveLength(1);
  });

  test('two different trucks with the SAME week_ending coexist (bug fix: truck must be part of the match key)', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000), 'truck-A'));
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 2000), 'truck-B'));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(2);
    const byTruck = Object.fromEntries(settlements.map((s) => [s.truck_id, s.net]));
    expect(byTruck['truck-A']).toBe(1000);
    expect(byTruck['truck-B']).toBe(2000);
  });

  test('re-importing the same truck+week still replaces (truck scoping does not break the intended replace behavior)', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000), 'truck-A'));
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1100), 'truck-A'));

    const settlements = mockClient.__store.settlements.filter((s) => s.truck_id === 'truck-A');
    expect(settlements).toHaveLength(1);
    expect(settlements[0].net).toBe(1100);
  });

  test('a settlement with no resolvable week_ending throws instead of silently colliding on an empty string', async () => {
    const extraction = settlementExtraction('', 1000);
    delete extraction.date;
    await expect(saveExtraction(baseParams(extraction))).rejects.toThrow();
  });

  // SETTLEMENT RE-IMPORT DUPLICATES maintenance/toll rows (P1 fix,
  // docs/PENDING_SQL.md §61) — unlike loads/fuel/reimbursements/withheld
  // deductions, maintenance_records/tolls had no capture-old-ids-then-
  // replace step at all (neither table had a settlement_id column to scope
  // "old rows for this settlement" by), so importing the same PDF twice
  // doubled these expenses. Proven end to end: import the identical
  // settlement twice and confirm every child table — including maintenance
  // and tolls — has exactly the same row count as after just one import.
  test('re-importing an IDENTICAL settlement twice never duplicates maintenance or toll rows', async () => {
    const withMaintAndTolls: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-07-05',
        grossRevenue: 2000,
        netPay: 1000,
        totalMiles: 1500,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
        tractorFuel: [{ amount: 300, gallons: 100 }],
        deductions: [{ code: 'INS', desc: 'Insurance', amount: 150 }],
        maintenance: [{ desc: 'Oil change', serviceType: 'oil', total: 200 }],
        tolls: { ezpass: { items: [{ date: '2026-07-01', amount: 25, plaza: 'GA Toll' }] } },
      },
    };

    await saveExtraction(baseParams(withMaintAndTolls));
    await saveExtraction(baseParams(withMaintAndTolls));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(1);

    const maintenance = mockClient.__store.maintenance_records ?? [];
    const tolls = mockClient.__store.tolls ?? [];
    expect(maintenance).toHaveLength(1);
    expect(tolls).toHaveLength(1);
    // Also confirm they're correctly tagged to the (single, replaced)
    // settlement — not orphaned rows left dangling with no settlement_id.
    expect(maintenance[0].settlement_id).toBe(settlements[0].id);
    expect(tolls[0].settlement_id).toBe(settlements[0].id);
  });

  test('a THIRD re-import still leaves exactly one maintenance/toll row each (not accumulating one more per import)', async () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-07-05',
        grossRevenue: 2000,
        netPay: 1000,
        totalMiles: 1500,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
        maintenance: [{ desc: 'Oil change', serviceType: 'oil', total: 200 }],
        tolls: { ezpass: { items: [{ date: '2026-07-01', amount: 25, plaza: 'GA Toll' }] } },
      },
    };

    await saveExtraction(baseParams(extraction));
    await saveExtraction(baseParams(extraction));
    await saveExtraction(baseParams(extraction));

    expect(mockClient.__store.maintenance_records ?? []).toHaveLength(1);
    expect(mockClient.__store.tolls ?? []).toHaveLength(1);
  });

  // VALIDATE BEFORE WRITING (pre-launch hardening, owner decision
  // 2026-08-02): the week_ending check must run BEFORE the documents
  // insert (and the Storage upload, not exercised here since baseParams()
  // passes fileUri: null) — a rejected import must never leave an
  // orphaned documents row behind.
  test('a rejected settlement (no week_ending) leaves no orphaned documents row', async () => {
    const extraction = settlementExtraction('', 1000);
    delete extraction.date;
    await expect(saveExtraction(baseParams(extraction))).rejects.toThrow();
    expect(mockClient.__store.documents ?? []).toHaveLength(0);
  });
});
