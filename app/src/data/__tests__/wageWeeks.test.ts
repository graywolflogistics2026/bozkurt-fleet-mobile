// ROUND 2, item G (owner 2026-11-13, device 11/06): the first W-2 wage week
// failed net_due_differs (printed 425.47, read 1,230.97; the 805.50
// difference = TOTAL WAGE EXPENSE). Identity:
//   NET AMOUNT DUE UNIT = TOTAL REV + TOTAL REIMBURSED
//                         − TOTAL DEDUCTIONS FROM TRUCK − TOTAL WAGE EXPENSE.
// Through the real range detection, gate and save path.
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
import { PRIME_18_WEEKS } from '@/src/settlementReader/__tests__/fixtures/prime18Weeks';
import { printedFromWeek, WAGES_1106, WAGES_1113, type WageWeek } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { addDays, figuresOf, readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { computeKpis } from '@/src/stats/kpi';
import type { ContentReading } from '@/src/settlementReader/schema';

const week = (iso: string) => PRIME_18_WEEKS.find((w) => w.weekEnding === iso)!;
const read = (iso: string, reading: ContentReading) => {
  const w = week(iso);
  return readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate: addDays(iso, 1) });
};
const wageReading = (iso: string, wage: WageWeek) => printedFromWeek(week(iso), { wage });

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

describe('11/06, the first wage week', () => {
  test('the device symptom: without the WAGE EXPENSE section the identity cannot hold (net_due_differs, 425.47 vs 1,230.97)', () => {
    const reading = wageReading('2026-11-06', WAGES_1106);
    // The old reading: no wage lines, no wage totals.
    const old: ContentReading = { ...reading, settlementLines: [], summary: reading.summary.filter((r) => !/WAGE|FROM SETTLEMENTS/.test(r.label)) };
    const gate = evaluateSettlementGate(sanitizeExtraction(read('2026-11-06', old).extraction!), { importDate: '2026-11-07' });
    expect(gate).toMatchObject({ status: 'fail', reason: 'net_due_differs', details: [{ check: 'netDueMismatch', printed: 425.47, read: 1230.97 }] });
  });

  test('read with its WAGE EXPENSE section: ready, profit 580.73, deposit 214.04', () => {
    const t = read('2026-11-06', wageReading('2026-11-06', WAGES_1106));
    expect(t.progress.state).toBe('ready');
    const s = t.extraction!.settlement!;
    expect(s.totalDeductions).toBe(1369.04);
    expect(s.totalWageExpense).toBe(805.5);
    expect(s.subtotalPriorWage).toBe(1230.97);
    expect(s.totalDeductionsFromSettlements).toBe(2174.54);
    expect(s.wageItems!.map((w) => [w.code, w.amount])).toEqual([['DF', 54.99], ['DU', 4.31], ['DU', 1.43], ['WC', 79.66], ['WD', 663.87], ['2S', 1.24]]);
    expect(figuresOf(t.extraction!, '2026-11-07')).toMatchObject({ status: 'pass', revenue: 2534.68, netDue: 425.47, deposited: 214.04, owedToCarrier: 0, expenses: 1953.95, profit: 580.73 });
  });

  test('saved: six wage rows of class WAGES (805.50), never asked; Home profit 580.73', async () => {
    // With its truck deduction and reimbursement lines (one line each side
    // here; the real split was not transcribed), so every line total ties.
    const reading = wageReading('2026-11-06', WAGES_1106);
    reading.settlementLines.push(
      { page: 2, section: 'deduction', code: '', description: 'TRUCK DEDUCTIONS', reference: '', amount: '1,369.04', direction: 'charge' },
      { page: 1, section: 'reimbursement', code: 'PC', description: 'PETTY CASH REIM', reference: '', amount: '39.50', direction: 'credit' },
      { page: 1, section: 'reimbursement', code: 'SF', description: 'FUEL TAX ADJUSTMENT', reference: '', amount: '25.83', direction: 'credit' },
      // Stage 2 (2026-11-25): a load's revenue comes from its own revenue
      // line, so the load's revenue line is read too (one line here, like
      // the fixture's one load: REVENUE FROM PRIME INC. = TOTAL REV).
      { page: 1, section: 'revenue', code: 'RV', description: 'TRIP REVENUE', reference: '4700001', amount: '2,534.68', direction: 'credit' }
    );
    expect(reading.loads.map((l) => [l.order, l.revenue])).toEqual([['4700001', '2,534.68']]);
    const t = read('2026-11-06', reading);
    expect(evaluateSettlementGate(sanitizeExtraction(t.extraction!), { importDate: '2026-11-07' })).toMatchObject({ status: 'pass', lineDetails: 'match' });
    await saveExtraction({ importDate: '2026-11-07', extraction: sanitizeExtraction(t.extraction!) as Extraction, userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
    const store = mockClient.__store as Record<string, any[]>;
    const wages = store.deductions.filter((d) => d.economic_class === 'WAGES');
    expect(wages).toHaveLength(6);
    expect(Math.round(wages.reduce((a, d) => a + d.amount, 0) * 100) / 100).toBe(805.5);
    expect(wages.every((d) => d.settlement_id && d.category === 'Wages & Payroll Taxes (W-2)')).toBe(true);
    const k = computeKpis({
      trucks: [{ id: TRUCK_ID, unit_number: '283940' } as any],
      settlements: store.settlements,
      loads: store.loads ?? [],
      deductions: store.deductions,
      fuelPurchases: store.fuel_purchases ?? [],
      maintenanceRecords: store.maintenance_records ?? [],
      tolls: store.tolls ?? [],
      reimbursements: store.reimbursements ?? [],
      truckScope: TRUCK_ID,
      window: { startIso: '2026-10-31', endIso: '2026-11-06' },
    });
    expect(k.net).toBeCloseTo(580.73, 2);
    expect(k.explanation?.ownExpenses.count).toBe(0);
  });

  test('a printed SUBTOTAL PRIOR WAGE D or recap that contradicts the identity fails the gate (named check)', () => {
    const reading = wageReading('2026-11-06', WAGES_1106);
    const bad = { ...reading, summary: reading.summary.map((r) => (r.label === 'SUBTOTAL PRIOR WAGE D' ? { ...r, amount: '1,330.97' } : r)) };
    const gate = evaluateSettlementGate(sanitizeExtraction(read('2026-11-06', bad).extraction!), { importDate: '2026-11-07' });
    expect(gate).toMatchObject({ status: 'fail', reason: 'net_due_differs', details: [{ check: 'subtotalPriorWage', printed: 1330.97, read: 1230.97 }] });
  });
});

test('11/13, the second wage week (wages on page 3): ready, profit 4,260.65, deposit 4,148.99', () => {
  const t = read('2026-11-13', wageReading('2026-11-13', WAGES_1113));
  expect(t.progress.state).toBe('ready');
  expect(t.extraction!.settlement!.totalDeductions).toBe(4418.59);
  expect(figuresOf(t.extraction!, '2026-11-14')).toMatchObject({ status: 'pass', revenue: 9586.39, netDue: 4147.59, deposited: 4148.99, expenses: 5325.74, profit: 4260.65 });
});

test('"NO ENTRY FOR THIS RUN" / ".00" under TOTAL WAGE EXPENSE = 0 wages; the week still ties', () => {
  const w = week('2026-10-16');
  for (const text of ['NO ENTRY FOR THIS RUN', '.00']) {
    const reading = printedFromWeek(w);
    reading.summary.splice(3, 0, { page: 2, label: 'TOTAL WAGE EXPENSE', amount: text });
    const t = read('2026-10-16', reading);
    expect(t.extraction!.settlement!.totalWageExpense).toBe(0);
    expect(figuresOf(t.extraction!, '2026-10-17')).toMatchObject({ status: 'pass', netDue: 6647.73, profit: 6747.73 });
  }
});
