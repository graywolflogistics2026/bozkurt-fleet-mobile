// FOR PRIME INC DRIVERS: ONLY LUMPERS FROM SETTLEMENTS (owner 2026-11-13,
// device: settlement-withheld rows appeared in the sheet and Lumpers was
// empty). The sheet = the owner's own out-of-pocket rows (Home's own-expense
// rule) + ONE read-only block "Lumpers — through settlement": lumper pay
// received (+), lumper advance deducted (−), the difference (wire fee), per
// week-ending month, outside every subtotal. The Accountant Package shows the
// same block. Real save path: saveExtraction() into the in-memory Supabase.
import type { Extraction } from '@/src/import/types';
import type { Deduction, Settlement } from '@/src/types/db';

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
import { PRIME_18_WEEKS, type GoldenWeek18 } from '@/src/settlementReader/__tests__/fixtures/prime18Weeks';
import { LINES_0828, printedFromWeek, WAGES_1106, WAGES_1113 } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { addDays, readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { buildPrimeDriverExpenseMonth, eligibleDeductionRowsForReport } from '@/src/stats/primeDriverExpenses';
import { settlementDocumentIds } from '@/src/stats/ownExpenseOrigin';
import { buildSettlementLumperLines, settlementLumpersFor } from '@/src/stats/settlementLumpers';
import { buildPrimeDriverExpenseReportHtml } from '@/src/stats/primeDriverExpenseReport';
import { findRowsNeedingAccountantCategory, suggestAccountantCategory } from '@/src/primeDriverExpenses/categoryMapping';
import { estimateNoticeStrings } from '@/src/legal/estimateNotice';
const NOTICE = estimateNoticeStrings((k) => k, 'BOZKA TRUCKING AI', 'n');

type Store = Record<string, any[]>;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function save(extraction: Extraction, importDate: string, truckId: string | null = TRUCK_ID) {
  await saveExtraction({ importDate, extraction, userId: USER_ID, truckId, driverId: null, driverShareAmount: null, fileUri: null, fileExt: 'pdf', mediaType: 'application/pdf', createContribution: false });
}

// Exactly what the screen reads.
function sheet(store: Store, year: number, month: number) {
  const deductions = (store.deductions ?? []) as Deduction[];
  const settlements = (store.settlements ?? []) as Settlement[];
  const rows = eligibleDeductionRowsForReport(deductions, settlementDocumentIds(settlements));
  return {
    rows,
    month: buildPrimeDriverExpenseMonth(rows, settlements, year, month),
    lumpers: settlementLumpersFor(buildSettlementLumperLines(settlements, deductions), year, month),
  };
}

const STRINGS = { title: 'Lumpers — through settlement', note: 'n', received: 'Lumper pay received', deducted: 'Lumper advance deducted', difference: 'Difference (wire fee)', monthTotal: 'Month total' };
const FMT = { money: (n: number) => n.toFixed(2), date: (iso: string) => iso };

describe('golden 07/17 (real lumper week): one through-settlement line, no sheet row', () => {
  let store: Store;
  beforeAll(async () => {
    mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
    await save(golden0717(), '2026-07-18');
    store = mockClient.__store as Store;
  });

  test('received 215.00 (OUTSIDE LUMPER 1099 PAY), deducted 215.00 (LUMPERS), difference 0.00', () => {
    const s = sheet(store, 2026, 7);
    expect(s.lumpers.lines).toEqual([{ settlementId: (store.settlements as Settlement[])[0].id, weekEnding: '2026-07-17', received: 215, deducted: 215, difference: 0 }]);
    expect([s.lumpers.received, s.lumpers.deducted, s.lumpers.difference]).toEqual([215, 215, 0]);
  });

  test('no settlement row is in the sheet, in any category, and none asks for a category', () => {
    const s = sheet(store, 2026, 7);
    expect(s.rows).toEqual([]);
    expect(s.month.grandTotal).toBe(0);
    expect(s.month.sections.find((x) => x.category === 'Lumpers')!.subtotal).toBe(0);
    expect(findRowsNeedingAccountantCategory(store.deductions ?? [], settlementDocumentIds(store.settlements ?? []))).toEqual([]);
  });

  test('the sheet export prints the block under Lumpers, outside the totals (Accountant Package: accountantPackageReport.test.ts)', () => {
    const s = sheet(store, 2026, 7);
    const html = buildPrimeDriverExpenseReportHtml('H', s.month, { categoryTableTitle: 'C', daysAwayFromHomeLabel: 'D', grandTotalLabel: 'G', noEntriesLabel: '-', disclaimer: 'x', estimateNotice: NOTICE }, FMT, { month: s.lumpers, strings: STRINGS });
    expect(html).toContain('Lumpers — through settlement');
    expect(html).toContain('+215.00');
    expect(html).toContain('−215.00');
    expect(html.indexOf('Lumpers — through settlement')).toBeGreaterThan(html.indexOf('>Lumpers<'));
  });
});

describe('monthly grouping, by week-ending month (owner amounts per month; the weeks are synthetic)', () => {
  // The repo has no lumper lines for the owner's real weeks, so these
  // statements carry the owner's month totals as one week each.
  const MONTHS: [string, number, number][] = [
    ['2026-07-24', 757.54, 760.09],
    ['2026-09-18', 1227.0, 1229.55],
    ['2026-10-23', 1759.0, 1761.55],
  ];
  const settlements = MONTHS.map(([we, pay, adv], i) => ({
    id: `s${i}`,
    week_ending: we,
    carrier: 'PRIME INC',
    truck_id: TRUCK_ID,
    statement: { prime: { lines: [
      { section: 'revenue' as const, label: 'REVENUE FROM PRIME INC', amount: 3000 },
      { section: 'revenue' as const, label: 'OUTSIDE LUMPER 1099 PAY', amount: pay },
      { section: 'misc' as const, label: 'LUMPERS', amount: -adv },
      { section: 'misc' as const, label: 'TOLLS', amount: -40 },
    ] } },
  }));
  const lines = buildSettlementLumperLines(settlements, []);

  test('received: July 757.54, August 0, September 1,227.00, October 1,759.00, year 3,743.54', () => {
    expect(settlementLumpersFor(lines, 2026, 7).received).toBe(757.54);
    expect(settlementLumpersFor(lines, 2026, 8).received).toBe(0);
    expect(settlementLumpersFor(lines, 2026, 8).lines).toEqual([]);
    expect(settlementLumpersFor(lines, 2026, 9).received).toBe(1227);
    expect(settlementLumpersFor(lines, 2026, 10).received).toBe(1759);
    expect(settlementLumpersFor(lines, 2026, null).received).toBe(3743.54);
  });

  test('deducted shown as a positive amount with −, difference = the wire fee', () => {
    const oct = settlementLumpersFor(lines, 2026, 10);
    expect([oct.deducted, oct.difference]).toEqual([1761.55, -2.55]);
  });

  test('only lumper lines are picked up (TOLLS and revenue are not)', () => {
    expect(lines.every((l) => l.received != null && l.deducted != null)).toBe(true);
    expect(lines).toHaveLength(3);
  });

  test('a known non-Prime carrier is skipped; a week saved again without a truck is shown once', () => {
    const werner = { ...settlements[0], id: 'w', carrier: 'WERNER ENTERPRISES' };
    const copy = { ...settlements[2], id: 'copy', truck_id: null };
    const l2 = buildSettlementLumperLines([...settlements, werner, copy], []);
    expect(l2.map((l) => l.settlementId)).toEqual(['s0', 's1', 's2']);
  });

  test('null never beats a number: no statement and no rows -> no line; rows only -> deducted from rows, received unknown', () => {
    const bare = { id: 'b', week_ending: '2026-06-05', carrier: 'PRIME INC', truck_id: TRUCK_ID, statement: null };
    expect(buildSettlementLumperLines([bare], [])).toEqual([]);
    const adv = { settlement_id: 'b', source: 'settlement', category: 'Lumper Fees', description: 'ADV FOR OUTSIDE LUMPER', amount: 216, code: 'WA' };
    const fuelAdv = { settlement_id: 'b', source: 'settlement', category: 'Advance Repayment', description: 'FUEL ADVANCE', amount: 500, code: 'WA' };
    expect(buildSettlementLumperLines([bare], [adv, fuelAdv])).toEqual([{ settlementId: 'b', weekEnding: '2026-06-05', received: null, deducted: 216, difference: null }]);
  });
});

describe('18 golden weeks (new reader save path): own rows unchanged, no other settlement row, re-import changes nothing', () => {
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

  // The owner's own manual expenses (device total 7,664.09), spread over
  // months, each with its accountant category as the app sets it.
  const own = (id: string, ded_date: string, category: string, amount: number) => ({
    id, user_id: USER_ID, truck_id: TRUCK_ID, settlement_id: null, document_id: null, source: 'manual', ded_date, description: id, category, amount,
    tax_deductible: true, payment_method: 'Business Credit Card', accountant_category: suggestAccountantCategory(category, 'manual'),
  });
  const OWN = [
    own('fuel', '2026-08-12', 'Fuel & DEF', 3200),
    own('repair', '2026-09-03', 'Maintenance & Repairs', 3520),
    own('wash', '2026-10-09', 'Truck Wash & Detailing', 581.01),
    own('scale', '2026-10-21', 'Tolls & Scales', 363.08),
  ];

  let store: Store;
  beforeAll(async () => {
    mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }], deductions: OWN.map((o) => ({ ...o })) });
    for (const w of PRIME_18_WEEKS) await save(readWeek(w), addDays(w.weekEnding, 1));
    store = mockClient.__store as Store;
  });

  const ownTotal = (s: Store) => {
    let total = 0;
    for (let m = 1; m <= 12; m++) total += sheet(s, 2026, m).month.grandTotal;
    return r2(total);
  };
  const snapshot = (s: Store) => JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => sheet(s, 2026, m)).map((x) => ({ rows: x.rows, total: x.month.grandTotal, lumpers: x.lumpers })));

  test('every sheet row is one of the owner\'s own rows; own total 7,664.09', () => {
    expect(OWN.every((o) => o.accountant_category)).toBe(true);
    expect(r2(OWN.reduce((a, o) => a + o.amount, 0))).toBe(7664.09);
    const ids = new Set(OWN.map((o) => o.id));
    for (let m = 1; m <= 12; m++) for (const r of sheet(store, 2026, m).rows) expect(ids.has(r.id)).toBe(true);
    expect(ownTotal(store)).toBe(7664.09);
  });

  test('no settlement-created row reaches the sheet, whatever its source label', () => {
    const settlementRows = ((store.deductions ?? []) as Deduction[]).filter((d) => !OWN.some((o) => o.id === d.id));
    const docIds = settlementDocumentIds(store.settlements ?? []);
    expect(eligibleDeductionRowsForReport(settlementRows, docIds)).toEqual([]);
    // Even a settlement line relabeled 'import' with a category, or one
    // that lost its link but carries its settlement's document: never.
    const s0 = (store.settlements as Settlement[])[0];
    const tricky = [
      { id: 'x1', ded_date: '2026-10-02', amount: 7020, accountant_category: 'Truck & Trailer Wash', source: 'import', description: 'EXTEND WR PURCH', category: 'Truck Wash & Detailing', settlement_id: s0.id, document_id: null },
      { id: 'x2', ded_date: '2026-10-02', amount: 63.06, accountant_category: 'Truck & Trailer Wash', source: 'import', description: 'CAFE', category: 'Truck Wash & Detailing', settlement_id: null, document_id: 'doc-s0' },
    ];
    expect(eligibleDeductionRowsForReport(tricky, new Set(['doc-s0']))).toEqual([]);
  });

  test('re-importing a week changes nothing in the sheet or the block', async () => {
    const before = snapshot(store);
    const w = PRIME_18_WEEKS.find((x) => x.weekEnding.startsWith('2026-10'))!;
    await save(readWeek(w), addDays(w.weekEnding, 2));
    store = mockClient.__store as Store;
    expect(snapshot(store)).toBe(before);
    expect(ownTotal(store)).toBe(7664.09);
  });
});
