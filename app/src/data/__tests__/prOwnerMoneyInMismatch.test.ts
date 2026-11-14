// PR = OWNER MONEY IN SURVIVES A LINE-DETAILS MISMATCH (owner 2026-11-13,
// device: 07/17 saved with lines_not_saved=true, pr_total 3,999.00, but no PR
// row and no Capital Account contribution). The gate drops every line row
// when the line details differ from the statement; the PR credit (owner money
// in, out of profit) is kept so its id-linked contribution is written. Real
// save path: the new reader's reading -> saveExtraction() -> in-memory DB.
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
import { summarizeCapitalFlows } from '@/src/stats/capitalAccount';

type Store = Record<string, any[]>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const week = (iso: string) => PRIME_18_WEEKS.find((w) => w.weekEnding === iso)!;
const NOTE = 'PERSONAL PYMNT RCV — owner money in (Prime settlement)';

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

async function save(w: GoldenWeek18, importDate = addDays(w.weekEnding, 1)) {
  await saveExtraction({ importDate, extraction: readWeek(w), userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
}

function prState(store: Store, iso: string) {
  const s = (store.settlements ?? []).find((x) => x.week_ending === iso)!;
  const pr = (store.deductions ?? []).filter((d) => d.settlement_id === s.id && String(d.code ?? '').toUpperCase() === 'PR');
  const contributions = (store.capital_transactions ?? []).filter((c) => pr.some((d) => d.id === c.linked_deduction_id));
  return { settlement: s, pr, contributions };
}

const kpi = (store: Store, window: { startIso: string; endIso: string } | null) =>
  computeKpis({ trucks: [{ id: TRUCK_ID, unit_number: '283940' } as never], settlements: store.settlements ?? [], loads: store.loads ?? [], deductions: store.deductions ?? [], fuelPurchases: store.fuel_purchases ?? [], maintenanceRecords: store.maintenance_records ?? [], tolls: store.tolls ?? [], reimbursements: store.reimbursements ?? [], truckScope: TRUCK_ID, window });

describe('07/17: PR 3,999.00 with the line details not matching', () => {
  let store: Store;
  beforeAll(async () => {
    mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
    await save(week('2026-07-17'));
    store = mockClient.__store as Store;
  });

  test('the gate said mismatch (no line rows) and the reading carried PR 3,999.00', () => {
    const { settlement } = prState(store, '2026-07-17');
    expect(settlement.statement.linesNotSaved).toBe(true);
    expect(settlement.statement.prime.prReimbursementTotal).toBe(3999);
  });

  test('1 PR credit row and 1 contribution of 3,999.00, same note and type as every PR contribution', () => {
    const { pr, contributions } = prState(store, '2026-07-17');
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({ amount: -3999, source: 'settlement', economic_class: 'PERSONAL', direction: 'credit', tax_deductible: false });
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ tx_type: 'contribution', amount: 3999, note: NOTE });
    // Only the PR credit survives the mismatch: no other line row.
    expect((store.deductions ?? []).filter((d) => d.settlement_id === pr[0].settlement_id)).toHaveLength(1);
    expect(store.loads ?? []).toEqual([]);
    expect(store.reimbursements ?? []).toEqual([]);
  });

  test('profit and every Home figure are unchanged by the PR row', () => {
    const w = week('2026-07-17');
    const window = { startIso: '2026-07-17', endIso: '2026-07-17' };
    const withPr = kpi(store, window);
    const withoutPr = kpi({ ...store, deductions: (store.deductions ?? []).filter((d) => d.code !== 'PR') }, window);
    expect([r2(withPr.gross), r2(withPr.expenses.total), r2(withPr.net), r2(withPr.deposits)]).toEqual([w.revenue, w.realExpense, w.profit, w.deposited]);
    expect(JSON.stringify(withPr.expenses)).toBe(JSON.stringify(withoutPr.expenses));
    expect(withPr.net).toBe(withoutPr.net);
    expect(withPr.explanation?.ownExpenses.count ?? 0).toBe(0);
  });

  test('re-importing 07/17 replaces it: still 1 PR row and 1 contribution', async () => {
    await save(week('2026-07-17'), '2026-07-20');
    store = mockClient.__store as Store;
    const { pr, contributions } = prState(store, '2026-07-17');
    expect(pr).toHaveLength(1);
    expect(contributions).toHaveLength(1);
    expect((store.capital_transactions ?? []).filter((c) => c.note === NOTE)).toHaveLength(1);
  });
});

describe('all 18 weeks: Owner\'s money gets 3,999.00 + 1.00, Home Yearly unchanged', () => {
  let store: Store;
  beforeAll(async () => {
    mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
    for (const w of PRIME_18_WEEKS) await save(w);
    store = mockClient.__store as Store;
  });

  test('08/21 PR 1.00 and 07/17 PR 3,999.00, one contribution each, 4,000.00 in all', () => {
    expect(prState(store, '2026-08-21').contributions.map((c) => c.amount)).toEqual([1]);
    expect(prState(store, '2026-07-17').contributions.map((c) => c.amount)).toEqual([3999]);
    const all = (store.capital_transactions ?? []).filter((c) => c.note === NOTE);
    expect(r2(all.reduce((a, c) => a + Number(c.amount), 0))).toBe(4000);
    const summary = summarizeCapitalFlows(store.capital_transactions ?? []);
    expect(r2(summary.netPosition)).toBe(4000);
  });

  test('Home Yearly: revenue 88,210.06, expenses 41,977.33, profit 46,232.73, deposited 39,913.01', () => {
    const k = kpi(store, { startIso: '2026-01-01', endIso: '2026-12-31' });
    expect([r2(k.gross), r2(k.expenses.total), r2(k.net), r2(k.deposits), k.miles.total]).toEqual([88210.06, 41977.33, 46232.73, 39913.01, 32607]);
  });
});
