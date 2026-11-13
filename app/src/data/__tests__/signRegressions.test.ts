// DEVICE REGRESSIONS: THE RECAP SIGN (owner 2026-11-13, build 664be90).
// 11/06 failed "deductionsFromSettlements printed -2174.54 read 2174.54",
// 07/17 (no wages) failed "printed -9232.02 read 9232.02": the recap prints
// TOTAL DEDUCTIONS FROM SETTLEMENTS with a trailing minus (= charge) and the
// check compared that signed value with a positive total. Every week below
// prints its recap exactly as the device statement does, is read by the
// reader (one read, the real gate) and saved through the real
// saveExtraction(); Home (computeKpis) shows the workbook profit.
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
import { LINES_0828, printedFromWeek, WAGES_1106, WAGES_1113 } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { addDays, readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import { computeKpis } from '@/src/stats/kpi';

const r2 = (n: number) => Math.round(n * 100) / 100;

// What the device statements print (owner, 2026-11-13).
const DEVICE = [
  { iso: '2026-07-17', recap: '9,232.02-', netCharges: '768.09-', gross: '317.42', profit: -293.62 },
  { iso: '2026-07-24', recap: '1,160.51-', netCharges: '1,160.51-', gross: '1,155.28-' },
  { iso: '2026-08-28', recap: '830.36-', netCharges: '405.36-', gross: '213.51-', profit: 436.04 },
  { iso: '2026-11-06', recap: '2,174.54-', netCharges: '2,109.21-', gross: '214.04', profit: 580.73 },
  { iso: '2026-11-13', recap: '5,517.65-', netCharges: '5,438.80-', gross: '4,148.99', profit: 4260.65 },
] as const;

function readingOf(iso: string) {
  const w = PRIME_18_WEEKS.find((x) => x.weekEnding === iso)!;
  const wage = iso === '2026-11-06' ? WAGES_1106 : iso === '2026-11-13' ? WAGES_1113 : undefined;
  return { w, reading: printedFromWeek(w, { lines: iso === '2026-08-28' ? LINES_0828 : undefined, wage }) };
}

test.each(DEVICE.map((d) => [d.iso, d] as const))('%s: the recap prints its charge totals with a trailing minus; one read, the gate passes, profit as the workbook', async (iso, d) => {
  const { w, reading } = readingOf(iso);
  const row = (label: string) => reading.summary.find((r) => r.label === label)?.amount;
  expect([row('TOTAL DEDUCTIONS FROM SETTLEMENTS'), row('NET CHARGES FROM SETTLEMENTS'), row('SETTLEMENT GROSS DUE TO/FROM OWNER')]).toEqual([d.recap, d.netCharges, d.gross]);

  const importDate = addDays(iso, 1);
  const t = readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
  expect(t.progress.state).toBe('ready');
  expect(t.progress.reads).toHaveLength(1);
  const extraction = sanitizeExtraction(t.extraction!);
  // ONE convention inside the app: a charge total is its size, positive.
  expect(extraction.settlement!.totalDeductionsFromSettlements).toBe(w.deductions);
  // The identities (the workbook weeks carry no settlement-page lines, so
  // only the totals are compared here).
  const identity = ['netDueMismatch', 'wageIdentityMismatch', 'depositMismatch'];
  expect(checkSettlementReconciliation(extraction).issues.filter((i) => identity.includes(i.type))).toEqual([]);
  expect(evaluateSettlementGate(extraction, { importDate })?.status).toBe('pass');

  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  await saveExtraction({ importDate, extraction, userId: USER_ID, truckId: TRUCK_ID, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
  const store = mockClient.__store as Record<string, any[]>;
  const k = computeKpis({
    trucks: [{ id: TRUCK_ID, unit_number: '283940' } as any],
    settlements: store.settlements ?? [],
    loads: store.loads ?? [],
    deductions: store.deductions ?? [],
    fuelPurchases: store.fuel_purchases ?? [],
    maintenanceRecords: store.maintenance_records ?? [],
    tolls: store.tolls ?? [],
    reimbursements: store.reimbursements ?? [],
    truckScope: TRUCK_ID,
    window: { startIso: addDays(iso, -6), endIso: iso },
  });
  expect(r2(k.net)).toBe(w.profit);
  if ('profit' in d) expect(r2(k.net)).toBe(d.profit);
  expect(k.explanation?.ownExpenses.count ?? 0).toBe(0);
});

test('every one of the 18 weeks prints the recap with a trailing minus, and its size is truck deductions + wages', () => {
  for (const w of PRIME_18_WEEKS) {
    const { reading } = readingOf(w.weekEnding);
    const recap = reading.summary.find((r) => r.label === 'TOTAL DEDUCTIONS FROM SETTLEMENTS')!.amount;
    expect(recap.endsWith('-')).toBe(true);
    expect(Number(recap.replace(/[,-]/g, ''))).toBe(w.deductions);
  }
});

test('the old mistake: a signed recap compared as printed fails; in the one convention it passes', () => {
  const { w, reading } = readingOf('2026-07-17');
  const t = readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate: '2026-07-18' });
  const s = sanitizeExtraction(t.extraction!).settlement!;
  const signed = { docType: 'settlement' as const, settlement: { ...s, totalDeductionsFromSettlements: -9232.02 } };
  const types = (e: Parameters<typeof checkSettlementReconciliation>[0]) => checkSettlementReconciliation(e).issues.map((i) => i.type).filter((x) => x === 'wageIdentityMismatch');
  expect(types(signed)).toEqual(['wageIdentityMismatch']);
  expect(types({ docType: 'settlement', settlement: s })).toEqual([]);
});
