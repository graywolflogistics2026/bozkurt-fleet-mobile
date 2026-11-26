import { PRIME_WEEK_ENDINGS, PRIME_WEEKS, primeWeekExtraction } from './fixtures/primeWeeks2026';
import { loadRevenueByOrder, splitPrimeLoads } from '@/src/import/primeLoads';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { mapSettlement } from '@/src/import/mapExtraction';
import type { Extraction } from '@/src/import/types';

// STAGE 2 (owner 2026-11-25): the Prime loads check compares the week's OWN
// revenue lines (LOAD_REVENUE_DESC, per order), never the reader's per-load
// figure. docs/decisions/advance-family-rule-proposal.md, "Stage 2 evidence
// 2026-11-25".

type Settlement = NonNullable<Extraction['settlement']>;
const week = (w: string) => primeWeekExtraction(w);
const withSettlement = (e: Extraction, patch: (s: Settlement) => Partial<Settlement>): Extraction => ({ ...e, settlement: { ...e.settlement!, ...patch(e.settlement!) } });
const r2 = (n: number) => Math.round(n * 100) / 100;
const gate = (e: Extraction) => evaluateSettlementGate(e, { importDate: '2026-11-25' })!;
const savedRevenue = (e: Extraction) => mapSettlement(e, 'user-1', 'truck-1').loads.map((l) => l.revenue);

// The reader's per-load sum vs the lines (the TRIP column), owner findings.
const TRIP_WEEKS: Record<string, { reader: number; lines: number }> = {
  '2026-07-31': { reader: 8150.34, lines: 5868.24 },
  '2026-09-25': { reader: 5196.86, lines: 3192.73 },
  '2026-10-02': { reader: 3410.09, lines: 2455.26 },
  '2026-10-16': { reader: 9065.27, lines: 6526.99 },
  '2026-11-20': { reader: 9705.48, lines: 6987.94 },
};
// The 8 weeks that save their rows today.
const SAVED_WITH_ROWS = PRIME_WEEK_ENDINGS.filter((w) => PRIME_WEEKS[w].saved.linesNotSaved !== true);

describe('stage 2 evidence on the 17 exported weeks', () => {
  test.each(PRIME_WEEK_ENDINGS)('%s: load lines per order + adjustments = REVENUE FROM PRIME INC. to the cent (except 08-14)', (w) => {
    const s = splitPrimeLoads(week(w))!;
    const difference = r2(s.loadRevenue + s.adjustmentTotal - s.statementRevenue!);
    expect(s.failures).toEqual([]);
    expect(difference).toBe(w === '2026-08-14' ? 94.68 : 0);
  });

  test('08-14: the Linehaul adjustment is stored as +47.34 (sign bug, stage 4); the loads check still fails, named', () => {
    const s = splitPrimeLoads(week('2026-08-14'))!;
    expect(s.adjustments).toEqual([{ order: '4845329', desc: 'Linehaul', amount: 47.34 }]);
    expect(s.matches).toBe(false);
    const g = gate(week('2026-08-14'));
    expect(g.status !== 'fail' && g.lineCauses).toContainEqual({ kind: 'loads', difference: 94.68 });
  });

  test.each(Object.keys(TRIP_WEEKS))('%s: the reader\'s per-load sum is the TRIP column; the check uses the lines', (w) => {
    const s = splitPrimeLoads(week(w))!;
    expect(s.readerLoadRevenue).toBe(TRIP_WEEKS[w].reader);
    expect(s.loadRevenue).toBe(TRIP_WEEKS[w].lines);
    expect(s.matches).toBe(true);
  });

  test('no load with miles lacks a revenue line; 08-28 has no load with miles and one mileless 2.33 line', () => {
    for (const w of PRIME_WEEK_ENDINGS) expect(splitPrimeLoads(week(w))!.lineRevenue).not.toContain(null);
    const s = splitPrimeLoads(week('2026-08-28'))!;
    expect(s.loads).toEqual([]);
    expect(s.adjustmentTotal).toBe(2.33);
    expect(s.statementRevenue).toBe(2.33);
    expect(s.matches).toBeNull();
  });

  test('10-02: saved loads.revenue is the per-order line sum (1552.33 / 633.07 / 269.86), not the TRIP amounts', () => {
    const s = splitPrimeLoads(week('2026-10-02'))!;
    expect(s.loads.map((l) => l.order)).toEqual(['5051626', '5069068', '5110361']);
    expect(s.loads.map((l) => l.revenue)).toEqual([2156.02, 879.26, 374.81]);
    expect(savedRevenue(week('2026-10-02'))).toEqual([1552.33, 633.07, 269.86]);
  });

  test.each(SAVED_WITH_ROWS)('%s (saved with rows today): saved loads.revenue per order equals the reader\'s figure, unchanged', (w) => {
    const e = week(w);
    const s = splitPrimeLoads(e)!;
    expect(savedRevenue(e)).toEqual(s.loads.map((l) => l.revenue));
  });
});

describe('stage 2 rules', () => {
  const W = '2026-10-02';
  const base = () => week(W);
  const revenueItems = (e: Extraction) => e.settlement!.revenueItems ?? [];

  test('two revenue lines for one order are summed', () => {
    // 5051626's 1,552.33 printed as two lines (1,500.00 + 52.33).
    const e = withSettlement(base(), (s) => ({
      revenueItems: (s.revenueItems ?? []).flatMap((r) =>
        r.order === '5051626' && /TRIP REV/i.test(r.desc ?? '') ? [{ ...r, amount: 1500 }, { ...r, desc: 'LINEHAUL', amount: 52.33 }] : [r]
      ),
    }));
    expect(loadRevenueByOrder(revenueItems(e)).get('5051626')).toBe(1552.33);
    expect(splitPrimeLoads(e)).toMatchObject({ lineRevenue: [1552.33, 633.07, 269.86], matches: true });
    expect(savedRevenue(e)).toEqual([1552.33, 633.07, 269.86]);
  });

  test('a load with no revenue line of its order: load_without_revenue_line, order kept; never a 0 that passes', () => {
    const e = withSettlement(base(), (s) => ({ revenueItems: (s.revenueItems ?? []).filter((r) => r.order !== '5110361') }));
    const s = splitPrimeLoads(e)!;
    expect(s.failures).toEqual([{ reason: 'load_without_revenue_line', order: '5110361' }]);
    expect(s.lineRevenue).toEqual([1552.33, 633.07, null]);
    expect(s.matches).toBe(false);
    const g = gate(e);
    expect(g).toMatchObject({ status: 'pass', lineDetails: 'mismatch' });
    expect(g.status !== 'fail' && g.lineCauses).toContainEqual({ kind: 'loads', difference: null, reasons: ['load_without_revenue_line'], orders: ['5110361'] });
    // The reader's figure is never a fallback.
    expect(savedRevenue(e)).toEqual([0, 0, 0]);
  });

  test('a load with miles and no order number: the same named failure', () => {
    const e = withSettlement(base(), (s) => ({ loads: (s.loads ?? []).map((l) => (l.order === '5069068' ? { ...l, order: '' } : l)) }));
    const s = splitPrimeLoads(e)!;
    expect(s.failures).toEqual([{ reason: 'load_without_revenue_line', order: null }]);
    expect(s.matches).toBe(false);
    const g = gate(e);
    expect(g.status !== 'fail' && g.lineCauses).toContainEqual({ kind: 'loads', difference: null, reasons: ['load_without_revenue_line'], orders: [null] });
  });

  test('a mileless revenue line (order with no load with miles) stays an adjustment', () => {
    const e = withSettlement(base(), (s) => ({
      revenueItems: [...(s.revenueItems ?? []), { code: 'RV', desc: 'Linehaul', order: '4999999', amount: -10 }],
      operating: {
        ...s.operating!,
        lines: (s.operating!.lines ?? []).map((l) => (l.label === 'REVENUE FROM PRIME INC.' ? { ...l, amount: r2((l.amount as number) - 10) } : l)),
      },
    }));
    const s = splitPrimeLoads(e)!;
    expect(s.adjustments).toEqual([{ order: '4999999', desc: 'Linehaul', amount: -10 }]);
    expect(s.loadRevenue).toBe(2455.26);
    expect(s.matches).toBe(true);
  });

  test('a non-Prime carrier is unchanged: no Prime split, loads keep the reader\'s figure', () => {
    const e = withSettlement(base(), () => ({ carrier: 'OTHER CARRIER LLC' }));
    expect(splitPrimeLoads(e)).toBeNull();
    expect(savedRevenue(e)).toEqual([2156.02, 879.26, 374.81]);
  });
});
