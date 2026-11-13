// ROUND 2, item B (owner 2026-11-13, device): Home said "$464.98 of your
// own expenses (11 items)" on 07/17 and showed -758.60 instead of -293.62.
// Rule: the own-expense layer holds only rows NOT created by a settlement
// import. Run through the real saveExtraction(), then computeKpis().
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
import { golden0717, USER_ID, TRUCK_ID } from './golden0717Fixture';
import { PRIME_13_WEEKS } from '@/src/settlementReader/__tests__/fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { computeKpis, isOrphanSettlementRow } from '@/src/stats/kpi';

type Row = Record<string, any>;
const store = () => mockClient.__store as Record<string, Row[]>;

async function save(extraction: Extraction, importDate: string) {
  await saveExtraction({ importDate, extraction, userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
}

function home(startIso: string, endIso: string, extra: Partial<Record<string, Row[]>> = {}) {
  const s = store();
  const t = (k: string) => [...(s[k] ?? []), ...(extra[k] ?? [])];
  return computeKpis({
    trucks: [{ id: TRUCK_ID, unit_number: '283940' } as any],
    settlements: t('settlements') as any,
    loads: t('loads') as any,
    deductions: t('deductions') as any,
    fuelPurchases: t('fuel_purchases') as any,
    maintenanceRecords: t('maintenance_records') as any,
    tolls: t('tolls') as any,
    reimbursements: t('reimbursements') as any,
    truckScope: TRUCK_ID,
    window: { startIso, endIso },
  });
}

const manual = (amount: number, date: string): Row => ({ id: 'manual-1', user_id: USER_ID, truck_id: TRUCK_ID, ded_date: date, amount, category: 'Supplies', description: 'Shop rags', source: 'manual', settlement_id: null });

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

test('07/17 saved by the real save path: Home -293.62, zero own items, no banner', async () => {
  await save(golden0717(), '2026-07-18');
  const k = home('2026-07-11', '2026-07-17');
  expect(k.net).toBeCloseTo(-293.62, 2);
  expect(k.explanation?.ownExpenses.count).toBe(0);
  expect(k.explanation?.ownExpenses.total).toBe(0);
});

test('08/28 read by the reader and saved: Home 436.04, zero own items', async () => {
  const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-08-28')!;
  const tr = readThrough(printedFromWeek(w, { lines: LINES_0828 }), { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
  await save(sanitizeExtraction(tr.extraction!), '2026-08-29');
  const k = home('2026-08-22', '2026-08-28');
  expect(k.net).toBeCloseTo(436.04, 2);
  expect(k.explanation?.ownExpenses.count).toBe(0);
});

test('a manual 10.00 expense: settlement profit - 10.00, banner says 1 item', async () => {
  await save(golden0717(), '2026-07-18');
  const k = home('2026-07-11', '2026-07-17', { deductions: [manual(10, '2026-07-15')] });
  expect(k.net).toBeCloseTo(-303.62, 2);
  expect(k.explanation?.ownExpenses.count).toBe(1);
  expect(k.explanation?.ownExpenses.total).toBeCloseTo(10, 2);
  expect(k.explanation?.settlementsProfit).toBeCloseTo(-293.62, 2);
});

test('a settlement-import row that lost its settlement link never counts again; it is listed as not counted', async () => {
  await save(golden0717(), '2026-07-18');
  const orphan: Row = { id: 'orphan-1', user_id: USER_ID, truck_id: TRUCK_ID, ded_date: '2026-07-16', amount: 464.98, category: 'Insurance', description: 'OCC ACC', source: 'settlement', settlement_id: null };
  expect(isOrphanSettlementRow(orphan)).toBe(true);
  const k = home('2026-07-11', '2026-07-17', { deductions: [orphan] });
  expect(k.net).toBeCloseTo(-293.62, 2);
  expect(k.explanation?.ownExpenses.count).toBe(0);
  expect(k.explanation?.notCounted.some((r) => r.reason === 'settlement_orphan' && r.amount === 464.98)).toBe(true);
});

test('a row saved by the same import (the settlement\'s own document) but with no link and another source never counts as own', async () => {
  await save(golden0717(), '2026-07-18');
  const settlement = store().settlements[0];
  settlement.document_id = settlement.document_id ?? 'doc-0717';
  const fromImport: Row = { id: 'unlinked-1', user_id: USER_ID, truck_id: TRUCK_ID, ded_date: '2026-07-16', amount: 42.5, category: 'Tolls & Scales', description: 'TOLLS', source: 'import', settlement_id: null, document_id: settlement.document_id };
  const k = home('2026-07-11', '2026-07-17', { deductions: [fromImport] });
  expect(k.net).toBeCloseTo(-293.62, 2);
  expect(k.explanation?.ownExpenses.count).toBe(0);
  // A receipt imported on its own (its own document) is the owner's expense.
  const receipt: Row = { ...fromImport, id: 'receipt-1', document_id: 'doc-receipt' };
  expect(home('2026-07-11', '2026-07-17', { deductions: [receipt] }).explanation?.ownExpenses.count).toBe(1);
});
