// CARRIER PAYROLL DRIVERS ON THE 18 GOLDEN WEEKS (owner 2026-11-13, §88,
// point 5): every week saved through the real saveExtraction(). Only 11/06
// and 11/13 (the two weeks with a WAGE EXPENSE section) get a driver row;
// one driver BOZKME, named from the payroll recap. The attribution changes
// nothing else: Home Yearly 88,210.06 / 41,977.33 / 46,232.73 / 39,913.01,
// every week's profit, every other table (deductions incl. PF PAYROLL FEE
// 10.00, capital_transactions, ...) identical to a save without it, and the
// tax estimate's driver payroll expense stays 0 (no double count).
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
import { withAttachment } from '@/src/settlementReader/machine';
import { computeKpis } from '@/src/stats/kpi';
import * as carrierPayroll from '@/src/import/carrierPayroll';
import { calcContractLaborYtd, sumDeductibleDriverPayroll } from '@/src/tax/driverPayroll';

const r2 = (n: number) => Math.round(n * 100) / 100;
type Store = Record<string, any[]>;

const RECAP_PAGE = {
  kind: 'payroll_recap' as const,
  repair: { invoice: '', shop: '', unit: '', description: '', odometer: '', total: '' },
  tolls: { agency: '', total: '', items: [] },
  payroll: { employees: [{ code: 'BOZKME', name: 'MERVE BOZKURT' }] },
};

// nameOn: the weeks whose payroll recap page was read before Certify.
function readWeek(w: GoldenWeek18, nameOn: string[]): Extraction {
  const iso = w.weekEnding;
  const wage = iso === '2026-11-06' ? WAGES_1106 : iso === '2026-11-13' ? WAGES_1113 : undefined;
  const t = readThrough(printedFromWeek(w, { lines: iso === '2026-08-28' ? LINES_0828 : undefined, wage }), {
    pages: w.pages,
    lastContentPage: w.lastContentPage,
    cashFlowPrinted: w.cashFlowPrinted,
    importDate: addDays(iso, 1),
  });
  expect(t.progress.state).toBe('ready');
  const e = nameOn.includes(iso) ? withAttachment(t.extraction!, w.lastContentPage + 1, RECAP_PAGE) : t.extraction!;
  return sanitizeExtraction(e);
}

async function saveAll(nameOn: string[]): Promise<Store> {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  for (const w of PRIME_18_WEEKS) {
    await saveExtraction({ importDate: addDays(w.weekEnding, 1), extraction: readWeek(w, nameOn), userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
  }
  return mockClient.__store as Store;
}

function kpi(s: Store, window: { startIso: string; endIso: string } | null) {
  return computeKpis({
    trucks: [{ id: TRUCK_ID, unit_number: '283940' } as any],
    settlements: s.settlements ?? [],
    loads: s.loads ?? [],
    deductions: s.deductions ?? [],
    fuelPurchases: s.fuel_purchases ?? [],
    maintenanceRecords: s.maintenance_records ?? [],
    tolls: s.tolls ?? [],
    reimbursements: s.reimbursements ?? [],
    truckScope: TRUCK_ID,
    window,
  });
}

// Every row without its generated ids (an extra insert shifts the fake's
// id counter) and without the new team label.
function canonical(s: Store) {
  const out: Record<string, unknown[]> = {};
  for (const [table, rows] of Object.entries(s)) {
    if (table === 'drivers' || table === 'driver_payments') continue;
    out[table] = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'id' && !k.endsWith('_id') && k !== 'team_week' && k !== 'created_at' && k !== 'updated_at')));
  }
  return out;
}

let store: Store;
beforeAll(async () => {
  // 11/06's recap page was not read before Certify, 11/13's was.
  store = await saveAll(['2026-11-13']);
});

test('only 11/06 and 11/13 get driver rows: one driver BOZKME, W-2 via Prime, name from the 11/13 payroll recap', () => {
  expect(store.drivers).toHaveLength(1);
  const d = store.drivers[0];
  expect([d.name, d.carrier, d.carrier_driver_code, d.paid_via_carrier_payroll, d.compensation_type]).toEqual(['MERVE BOZKURT', 'PRIME INC', 'BOZKME', true, 'w2_employee']);
  const pays = [...store.driver_payments].sort((a, b) => a.date.localeCompare(b.date));
  expect(pays.map((p) => [p.date, p.gross_pay, p.employer_taxes, p.work_comp, p.total_cost, p.source, p.driver_id])).toEqual([
    ['2026-11-06', 665.11, 60.73, 79.66, 805.5, 'settlement', d.id],
    ['2026-11-13', 913.06, 76.85, 109.15, 1099.06, 'settlement', d.id],
  ]);
  const weekOf = new Map(store.settlements.map((s) => [s.id, s.week_ending]));
  expect(pays.map((p) => weekOf.get(p.settlement_id))).toEqual(['2026-11-06', '2026-11-13']);
  // The team label is written for the wage weeks only (this fixture prints
  // no "+ TEAM" revenue line; carrierPayroll.test.ts covers the label).
  expect(store.settlements.filter((s) => s.team_week != null).map((s) => [s.week_ending, s.team_week]).sort()).toEqual([
    ['2026-11-06', false],
    ['2026-11-13', false],
  ]);
  const summary = carrierPayroll.carrierPayrollSummary(store.driver_payments, d.id, '2026-11-14');
  expect([summary.ytd.total, summary.ytd.wages, summary.paidWeeks, summary.latest?.date]).toEqual([1904.56, 1578.17, 2, '2026-11-13']);
  // The settlement is never routed to the driver.
  expect(store.settlements.every((s) => s.driver_id == null)).toBe(true);
});

test('totals unchanged: Home Yearly 88,210.06 / 41,977.33 / 46,232.73 / 39,913.01 and every week\'s profit', () => {
  const k = kpi(store, null);
  expect([r2(k.gross), r2(k.expenses.total), r2(k.net), r2(k.deposits)]).toEqual([88210.06, 41977.33, 46232.73, 39913.01]);
  for (const w of PRIME_18_WEEKS) {
    expect([w.weekEnding, r2(kpi(store, { startIso: addDays(w.weekEnding, -6), endIso: w.weekEnding }).net)]).toEqual([w.weekEnding, w.profit]);
  }
  // No double count: the tax estimate's driver payroll and the 1099 list.
  expect(sumDeductibleDriverPayroll(store.driver_payments)).toBe(0);
  expect(calcContractLaborYtd(store.driver_payments, store.drivers, 2026)).toEqual([]);
});

test('every other table is identical to a save without the driver attribution (deductions, PF 10.00, capital)', async () => {
  const spy = jest.spyOn(carrierPayroll, 'carrierPayrollOf').mockReturnValue(null);
  const without = await saveAll(['2026-11-13']);
  spy.mockRestore();
  expect(without.driver_payments ?? []).toHaveLength(0);
  expect(canonical(store)).toEqual(canonical(without));
});

test('re-importing 11/13 replaces its driver row (never two), and a name typed by the owner is never replaced', async () => {
  mockClient = createFakeSupabase(store);
  const d = (mockClient.__store as Store).drivers[0];
  d.name = 'Merve Bozkurt';
  const w = PRIME_18_WEEKS.find((x) => x.weekEnding === '2026-11-13')!;
  await saveExtraction({ importDate: addDays(w.weekEnding, 1), extraction: readWeek(w, ['2026-11-13']), userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
  const s = mockClient.__store as Store;
  expect(s.drivers).toHaveLength(1);
  expect(s.drivers[0].name).toBe('Merve Bozkurt');
  expect(s.driver_payments.map((p) => p.date).sort()).toEqual(['2026-11-06', '2026-11-13']);
});
