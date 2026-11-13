// THE 18 GOLDEN WEEKS SAVED (round 2 items B and K4, owner 2026-11-13):
// every week read by the reader and saved through the real saveExtraction(),
// in shuffled order (newest first, then the rest out of order). Home
// (computeKpis) shows each week's workbook profit with zero own expenses,
// the all-time profit is 46,232.73, and the order of the imports changes
// nothing: everything is recomputed by week_ending.
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
import { USER_ID, TRUCK_ID } from './golden0717Fixture';
import { PRIME_18_WEEKS, type GoldenWeek18 } from '@/src/settlementReader/__tests__/fixtures/prime18Weeks';
import { LINES_0828, printedFromWeek, WAGES_1106, WAGES_1113 } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { addDays, readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { computeKpis } from '@/src/stats/kpi';

const r2 = (n: number) => Math.round(n * 100) / 100;

function readWeek(w: GoldenWeek18): Extraction {
  const iso = w.weekEnding;
  const wage = iso === '2026-11-06' ? WAGES_1106 : iso === '2026-11-13' ? WAGES_1113 : undefined;
  const t = readThrough(printedFromWeek(w, { lines: iso === '2026-08-28' ? LINES_0828 : undefined, wage }), {
    pages: w.pages,
    lastContentPage: w.lastContentPage,
    cashFlowPrinted: w.cashFlowPrinted,
    importDate: addDays(iso, 1),
  });
  expect(t.progress.state).toBe('ready');
  return sanitizeExtraction(t.extraction!);
}

async function saveAll(order: GoldenWeek18[]) {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  for (const w of order) {
    await saveExtraction({ importDate: addDays(w.weekEnding, 1), extraction: readWeek(w), userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
  }
  return mockClient.__store as Record<string, any[]>;
}

function home(store: Record<string, any[]>, window: { startIso: string; endIso: string } | null) {
  return computeKpis({
    trucks: [{ id: TRUCK_ID, unit_number: '283940' } as any],
    settlements: store.settlements ?? [],
    loads: store.loads ?? [],
    deductions: store.deductions ?? [],
    fuelPurchases: store.fuel_purchases ?? [],
    maintenanceRecords: store.maintenance_records ?? [],
    tolls: store.tolls ?? [],
    reimbursements: store.reimbursements ?? [],
    truckScope: TRUCK_ID,
    window,
  });
}

// Newest first, then every other week, then the rest.
const SHUFFLED = [...PRIME_18_WEEKS].reverse().filter((_, i) => i % 2 === 0).concat([...PRIME_18_WEEKS].reverse().filter((_, i) => i % 2 === 1));

test('18 weeks saved out of order: each week on Home is its workbook profit, zero own expenses; all-time 46,232.73', async () => {
  const store = await saveAll(SHUFFLED);
  expect(store.settlements).toHaveLength(18);
  for (const w of PRIME_18_WEEKS) {
    const k = home(store, { startIso: addDays(w.weekEnding, -6), endIso: w.weekEnding });
    expect([w.weekEnding, r2(k.net), k.explanation?.ownExpenses.count ?? 0]).toEqual([w.weekEnding, w.profit, 0]);
  }
  const all = home(store, null);
  expect(r2(all.net)).toBe(46232.73);
  expect(r2(all.gross)).toBe(88210.06);
});

test('the order of the imports changes nothing (in order vs out of order)', async () => {
  const inOrder = await saveAll(PRIME_18_WEEKS);
  const a = PRIME_18_WEEKS.map((w) => r2(home(inOrder, { startIso: addDays(w.weekEnding, -6), endIso: w.weekEnding }).net));
  const shuffled = await saveAll(SHUFFLED);
  const b = PRIME_18_WEEKS.map((w) => r2(home(shuffled, { startIso: addDays(w.weekEnding, -6), endIso: w.weekEnding }).net));
  expect(b).toEqual(a);
  expect(r2(home(shuffled, null).net)).toBe(r2(home(inOrder, null).net));
});
