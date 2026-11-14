// TOLL DOUBLE COUNTS IN CASH FLOW AND THE PROFIT AUDIT CROSS-CHECK (owner
// 2026-11-14): both use the Tolls & Fees rule (tollsSummary.ts). A tolls
// row covered by a toll/fee line of its own settlement is never added on
// top of that line; settlement toll rows are dated by week ending.
import { buildSpendEvents } from '@/src/stats/cashFlowForecast';
import { computeKpis } from '@/src/stats/kpi';
import { deductions as ownerDeductions, settlements, toll, tolls as ownerTolls } from './fixtures/ownerTolls';

const r2 = (n: number) => Math.round(n * 100) / 100;
// 12 weeks before 2026-11-14 (CLASSIFICATION_WINDOW_WEEKS).
const WINDOW_START = '2026-08-22';
const weekOf = new Map(settlements.map((s) => [s.id, s.week_ending]));
// Withheld lines dated on their week ending (as Prime prints them); the
// owner's CAT Scale tickets keep their own dates.
const deductions = ownerDeductions
  .filter((d) => d.category === 'Tolls & Scales')
  .map((d) => ({ ...d, ded_date: d.settlement_id ? weekOf.get(d.settlement_id)! : d.ded_date, tax_deductible: true }));

const tollsSpend = (ts: typeof ownerTolls, ds = deductions, sts = settlements) =>
  r2(
    buildSpendEvents(ds as never, [], [], ts as never, WINDOW_START, sts)
      .filter((e) => e.category === 'Tolls & Scales')
      .reduce((a, e) => a + e.amount, 0)
  );

describe('Cash Flow 12-week spend', () => {
  test('owner data: Tolls & Scales 893.94 -> 826.97, down exactly by the itemized rows inside the window (66.97)', () => {
    const itemizedInWindow = r2(ownerTolls.filter((t) => (t.toll_date ?? '') >= WINDOW_START).reduce((a, t) => a + (t.amount ?? 0), 0));
    expect(itemizedInWindow).toBe(66.97); // 09/18 breakdown 66.72 + 09/04 transponder 0.25
    const after = tollsSpend(ownerTolls);
    // Without the tolls table the spend is the same: every row is covered.
    expect(after).toBe(tollsSpend([]));
    expect(after).toBe(826.97);
    expect(r2(after + itemizedInWindow)).toBe(893.94); // the old sum
  });

  test('a week with itemized rows and no toll deduction still counts them', () => {
    const extra = [toll('s1030', 'NJTP', 7.5, '2026-10-28'), toll('s1030', 'HCTRA', 2.5, '2026-10-29')];
    const sts = [...settlements, { id: 's1030', week_ending: '2026-10-30', carrier: 'PRIME INC' }];
    expect(tollsSpend([...ownerTolls, ...extra], deductions, sts)).toBe(836.97);
    // Dated by the week ending.
    const events = buildSpendEvents([], [], [], extra as never, WINDOW_START, sts);
    expect(events.map((e) => e.date)).toEqual(['2026-10-30', '2026-10-30']);
  });

  test('a hand-entered toll without a settlement counts on its own date', () => {
    const manual = toll(null, 'I-90 plaza', 12.4, '2026-11-01', 'manual');
    expect(tollsSpend([...ownerTolls, manual])).toBe(839.37);
    expect(buildSpendEvents([], [], [], [manual] as never, WINDOW_START).map((e) => [e.date, e.amount])).toEqual([['2026-11-01', 12.4]]);
  });

  test('a toll line dated before the window but whose week ends inside it is in the window', () => {
    const d = { ...deductions[1], ded_date: '2026-08-20', settlement_id: 'sW' };
    const events = buildSpendEvents([d] as never, [], [], [], WINDOW_START, [{ id: 'sW', week_ending: '2026-08-28' }]);
    expect(events.map((e) => e.date)).toEqual(['2026-08-28']);
  });
});

describe('Profit Audit cross-check', () => {
  // (Expense lines are printed negative.) A statement-backed week ending 09/18 whose only expense is the toll
  // line 356.69, with its 8 itemized tolls rows (66.72) saved too.
  const settlement = {
    id: 's0918',
    week_ending: '2026-09-18',
    truck_id: null,
    gross: 1000,
    net: 643.31,
    miles: 1000,
    statement: {
      source: 'prime_statement',
      printed: { grossRevenue: 1000, deposit: 643.31, depositSource: 'printed' },
      prime: {
        gatePassed: true,
        lines: [
          { section: 'revenue', label: 'TOTAL REVENUE', amount: 1000 },
          { section: 'misc', label: 'TOLLS', amount: -356.69 },
        ],
        totals: { totalRevenue: 1000, totalMiscellaneous: -356.69, totalVariableCosts: -356.69, totalOperatingExpenses: -356.69, totalStatement: 643.31, priorWeekBalanceForward: 0 },
      },
    },
  };
  const tollLine = deductions.find((d) => d.settlement_id === 's0918')!;
  const itemized = ownerTolls.filter((t) => t.settlement_id === 's0918');
  const kpi = (ds: unknown[], ts: unknown[]) =>
    computeKpis({
      trucks: [],
      settlements: [settlement] as never,
      loads: [],
      deductions: ds as never,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: ts as never,
      reimbursements: [],
      truckScope: null,
      window: null,
    });

  test('week 09/18: no toll difference (the 66.72 itemized rows are the line\'s breakdown)', () => {
    expect(itemized).toHaveLength(8);
    const k = kpi([tollLine], itemized);
    expect(k.bridge.crossChecks).toEqual([]);
  });

  test('itemized rows with no toll line in the week still count (a real difference is still shown)', () => {
    const k = kpi([], itemized);
    expect(k.bridge.crossChecks.map((c) => [c.weekEnding, c.difference])).toEqual([['2026-09-18', r2(66.72 - 356.69)]]);
  });

  test('profit is the statement\'s either way', () => {
    expect(r2(kpi([tollLine], itemized).net)).toBe(r2(kpi([tollLine], []).net));
  });
});
