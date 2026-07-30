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

  test('re-importing the same week replaces it — exactly one settlement remains', async () => {
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1000)));
    await saveExtraction(baseParams(settlementExtraction('2026-07-05', 1500)));

    const settlements = mockClient.__store.settlements;
    expect(settlements).toHaveLength(1);
    expect(settlements[0].net).toBe(1500);

    // business_balance credited only once (first import), not twice.
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(1000);
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
});
