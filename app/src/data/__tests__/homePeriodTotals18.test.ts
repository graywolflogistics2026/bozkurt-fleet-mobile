// HOME PERIOD TOTALS = THE SETTLEMENTS (owner 2026-11-13, device: all 18
// weeks certified, every week right, but Home Yearly showed Cost/Mile 1.52
// and Profit/Mile 1.18 instead of 1.29 / 1.42). Every Home period is the
// sum of the same weeks' settlement figures, Cost/Mile is real expenses ÷
// miles even when the truck has a cost basis entered (the estimate is not a
// business expense), and Home agrees with Settlements, Profit, the
// Accountant Package's profit note and the profit bridge. An own expense of
// 10.00 moves expenses and profit by exactly 10.00.
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
import { PRIME_18_TOTALS, PRIME_18_WEEKS, type GoldenWeek18 } from '@/src/settlementReader/__tests__/fixtures/prime18Weeks';
import { LINES_0828, printedFromWeek, WAGES_1106, WAGES_1113 } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { addDays, readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { computeKpis, type KpiResult } from '@/src/stats/kpi';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { HERO_PERIODS } from '@/src/stats/heroPeriod';
import { resolveHeroPeriodDateWindow } from '@/src/stats/heroPeriodWindow';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildSettlementsTotalsBar } from '@/src/stats/settlementsSummary';
import type { ComparisonTruck } from '@/src/stats/truckComparison';

const r2 = (n: number) => Math.round(n * 100) / 100;
const NOW = new Date(2026, 10, 14, 12, 0, 0);
const WEEK_ENDINGS = PRIME_18_WEEKS.map((w) => w.weekEnding);

const PLAIN_TRUCK = { id: TRUCK_ID, unit_number: '283940' } as ComparisonTruck;
// The device: a truck with a cost basis entered (loan payment + the
// extended warranty spread over its term).
const COST_BASIS_TRUCK = {
  ...PLAIN_TRUCK,
  cost_basis_ownership_mode: 'loan',
  cost_basis_loan_monthly_payment: 1500,
  cost_basis_warranty_cost: 7020,
  cost_basis_warranty_term_months: 24,
} as ComparisonTruck;

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

type Store = Record<string, any[]>;
let store: Store;

beforeAll(async () => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  for (const w of PRIME_18_WEEKS) {
    await saveExtraction({ importDate: addDays(w.weekEnding, 1), extraction: readWeek(w), userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
  }
  store = mockClient.__store as Store;
});

const rowsOf = (s: Store) => ({
  settlements: s.settlements ?? [],
  loads: s.loads ?? [],
  deductions: s.deductions ?? [],
  fuelPurchases: s.fuel_purchases ?? [],
  maintenanceRecords: s.maintenance_records ?? [],
  tolls: s.tolls ?? [],
  reimbursements: s.reimbursements ?? [],
});

function home(s: Store, period: (typeof HERO_PERIODS)[number], truck: ComparisonTruck = COST_BASIS_TRUCK) {
  const r = rowsOf(s);
  return buildPeriodScopedCpm(period, WEEK_ENDINGS, [truck], r.settlements, r.loads, r.deductions, r.fuelPurchases, r.maintenanceRecords, r.tolls, r.reimbursements, TRUCK_ID, null, NOW);
}

function kpiFor(s: Store, window: { startIso: string; endIso: string } | null, truck: ComparisonTruck = COST_BASIS_TRUCK): KpiResult {
  return computeKpis({ trucks: [truck], ...rowsOf(s), truckScope: TRUCK_ID, window });
}

// The same weeks' settlement figures, summed.
function expectedFor(weeks: GoldenWeek18[]) {
  const sum = (f: (w: GoldenWeek18) => number) => r2(weeks.reduce((a, w) => a + f(w), 0));
  const revenue = sum((w) => w.revenue);
  const expenses = sum((w) => w.realExpense);
  const miles = weeks.reduce((a, w) => a + w.miles, 0);
  return {
    revenue,
    expenses,
    profit: sum((w) => w.profit),
    deposited: sum((w) => w.deposited),
    miles,
    rpm: miles > 0 ? r2(revenue / miles) : null,
    cpm: miles > 0 ? r2(expenses / miles) : null,
    ppm: miles > 0 ? r2((revenue - expenses) / miles) : null,
  };
}

function actual(k: KpiResult) {
  return {
    revenue: r2(k.gross),
    expenses: r2(k.expenses.total),
    profit: r2(k.net),
    deposited: r2(k.deposits),
    miles: k.miles.total,
    rpm: k.rpm == null ? null : r2(k.rpm),
    cpm: k.cpm == null ? null : r2(k.cpm),
    ppm: k.ppm == null ? null : r2(k.ppm),
  };
}

const YEAR = { revenue: 88210.06, expenses: 41977.33, profit: 46232.73, deposited: 39913.01, miles: 32607, rpm: 2.71, cpm: 1.29, ppm: 1.42 };

test('the workbook totals the expectations rest on', () => {
  expect(expectedFor(PRIME_18_WEEKS)).toEqual(YEAR);
  expect([PRIME_18_TOTALS.revenue, PRIME_18_TOTALS.realExpense, PRIME_18_TOTALS.profit, PRIME_18_TOTALS.deposited, PRIME_18_TOTALS.miles]).toEqual([
    YEAR.revenue,
    YEAR.expenses,
    YEAR.profit,
    YEAR.deposited,
    YEAR.miles,
  ]);
});

test.each(HERO_PERIODS)('Home %s = the sum of the same weeks\' settlement figures (truck cost basis entered)', (period) => {
  const window = resolveHeroPeriodDateWindow(period, WEEK_ENDINGS, NOW)!;
  const weeks = PRIME_18_WEEKS.filter((w) => w.weekEnding >= window.startIso && w.weekEnding <= window.endIso);
  expect(weeks.length).toBeGreaterThan(0);
  const h = home(store, period);
  expect(actual(h.kpi!)).toEqual(expectedFor(weeks));
  // The per-mile trio Home shows is the same object.
  expect(h.cpm!.costPerMile).toBe(h.kpi!.cpm);
  expect(h.cpm!.profitPerMile).toBe(h.kpi!.ppm);
  expect(h.kpi!.bridge.difference).toBe(0);
  expect(r2(h.kpi!.bridge.profit)).toBe(r2(h.kpi!.net));
});

test('Home Yearly and All: revenue 88,210.06, real expenses 41,977.33, profit 46,232.73, deposited 39,913.01, 32,607 mi, RPM 2.71, CPM 1.29, PPM 1.42', () => {
  expect(actual(home(store, 'yearly').kpi!)).toEqual(YEAR);
  expect(actual(kpiFor(store, null))).toEqual(YEAR);
  // With or without a cost basis on the truck: identical.
  expect(actual(home(store, 'yearly', PLAIN_TRUCK).kpi!)).toEqual(YEAR);
  // Nothing hides in an own-expense layer: zero own items all year.
  expect(home(store, 'yearly').kpi!.explanation?.ownExpenses.count ?? 0).toBe(0);
});

test('Home = Settlements = Profit = Accountant Package profit note = profit bridge, same window', () => {
  const window = { startIso: '2026-01-01', endIso: '2026-12-31' };
  const k = kpiFor(store, window);
  // Settlements screen: totals bar (gross, miles) + its explainer (computeKpis on the period).
  const bar = buildSettlementsTotalsBar(store.settlements as never);
  expect([r2(bar.gross), bar.miles]).toEqual([YEAR.revenue, YEAR.miles]);
  expect(r2(kpiFor(store, { startIso: '2026-01-01', endIso: '9999-12-31' }).explanation!.profit)).toBe(YEAR.profit);
  // Profit screen.
  const r = rowsOf(store);
  const pa = buildProfitAnalysis(r.settlements, r.fuelPurchases, r.maintenanceRecords, r.deductions, r.reimbursements, null, NOW, r.tolls);
  expect([r2(pa.revenue), r2(pa.totalExpenses), r2(pa.netIncome)]).toEqual([YEAR.revenue, YEAR.expenses, YEAR.profit]);
  // Accountant Package profit note: computeKpis fleet-wide on the calendar year.
  const ap = computeKpis({ trucks: [COST_BASIS_TRUCK], ...r, loads: [], truckScope: null, window });
  expect(r2(ap.explanation!.profit)).toBe(YEAR.profit);
  // Profit bridge.
  expect(r2(k.bridge.profit)).toBe(YEAR.profit);
  expect(k.bridge.difference).toBe(0);
  expect(actual(k)).toEqual(YEAR);
});

test('a manual own expense of 10.00 moves expenses and profit by exactly 10.00 (and Cost/Mile by 10.00 / miles)', () => {
  const withOwn: Store = {
    ...store,
    deductions: [
      ...(store.deductions ?? []),
      { id: 'own-10', user_id: USER_ID, truck_id: TRUCK_ID, settlement_id: null, source: 'manual', ded_date: '2026-10-20', description: 'Truck wash', category: 'Truck Wash & Detailing', amount: 10, tax_deductible: true, payment_method: 'Business Credit Card' },
    ],
  };
  const before = home(store, 'yearly').kpi!;
  const after = home(withOwn, 'yearly').kpi!;
  expect(r2(after.expenses.total - before.expenses.total)).toBe(10);
  expect(r2(before.net - after.net)).toBe(10);
  expect(after.cpm! - before.cpm!).toBeCloseTo(10 / YEAR.miles, 10);
  expect(after.explanation!.ownExpenses.count).toBe(1);
  expect(r2(after.explanation!.ownExpenses.total)).toBe(10);
});
