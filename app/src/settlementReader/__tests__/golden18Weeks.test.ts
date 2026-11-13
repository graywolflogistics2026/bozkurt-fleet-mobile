// THE 18 GOLDEN WEEKS (owner workbook prime-haftalik-dogru-rakamlar.xlsx,
// sheet "Detay", round 2 item K1, 2026-11-13). Each week printed as the
// content call would return it, read by the reader (range -> one read ->
// the one gate): every figure is the workbook's. Totals and YTD continuity
// are exact. The two W-2 wage weeks print their WAGE EXPENSE section.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { PRIME_18_TOTALS, PRIME_18_WEEKS } from './fixtures/prime18Weeks';
import { LINES_0828, printedFromWeek, WAGES_1106, WAGES_1113 } from './fixtures/printedReading';
import { addDays, figuresOf, readThrough } from './fixtures/runReader';

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (k: 'revenue' | 'deposited' | 'profit' | 'miles' | 'realExpense' | 'wages') => r2(PRIME_18_WEEKS.reduce((a, w) => a + w[k], 0));
const wageOf = (iso: string) => (iso === '2026-11-06' ? WAGES_1106 : iso === '2026-11-13' ? WAGES_1113 : undefined);

test('the workbook: 18 weeks, the first 13 unchanged, totals exact', () => {
  expect(PRIME_18_WEEKS).toHaveLength(18);
  expect(PRIME_18_WEEKS.slice(0, 13).map(({ wages: _w, ...w }) => w)).toEqual(PRIME_13_WEEKS);
  expect({ revenue: sum('revenue'), deposited: sum('deposited'), profit: sum('profit'), miles: sum('miles'), realExpense: sum('realExpense'), wages: sum('wages') }).toEqual({
    revenue: 88210.06,
    deposited: 39913.01,
    profit: 46232.73,
    miles: 32607,
    realExpense: 41977.33,
    wages: 1904.56,
  });
  expect(PRIME_18_TOTALS).toMatchObject({ revenue: 88210.06, deposited: 39913.01, profit: 46232.73, miles: 32607 });
});

test('YTD continuity is exact: each week\'s YTD revenue and YTD paid = the previous week + this week', () => {
  let ytdRevenue = 0;
  let ytdPaid = 0;
  for (const w of PRIME_18_WEEKS) {
    ytdRevenue = r2(ytdRevenue + w.revenue);
    ytdPaid = r2(ytdPaid + w.deposited);
    expect([w.weekEnding, w.ytdRevenue, w.ytdPaid, w.ytdRevenueDiff, w.ytdPaidDiff]).toEqual([w.weekEnding, ytdRevenue, ytdPaid, 0, 0]);
  }
  expect([ytdRevenue, ytdPaid]).toEqual([88210.06, 39913.01]);
});

test.each(PRIME_18_WEEKS.map((w) => [w.weekEnding, w] as const))('%s through the reader: ready, every figure is the workbook\'s', (iso, w) => {
  const importDate = addDays(iso, 1);
  const reading = printedFromWeek(w, { lines: iso === '2026-08-28' ? LINES_0828 : undefined, wage: wageOf(iso) });
  const t = readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
  expect(t.progress.state).toBe('ready');
  expect(figuresOf(t.extraction!, importDate)).toEqual({
    status: 'pass',
    revenue: w.revenue,
    netDue: w.netDue,
    deposited: w.deposited,
    owedToCarrier: w.owedToCarrier,
    expenses: w.realExpense,
    profit: w.profit,
    miles: w.miles,
    bondHeld: w.bondHeld,
    ytdRevenue: w.ytdRevenue,
    ytdPaid: w.ytdPaid,
  });
  expect(r2(w.netDue + w.balanceForward + w.interestIncome - w.interestExpense)).toBe(w.grossDue);
  // Net due identity with wages (11/06, 11/13).
  expect(r2(w.revenue + w.reimbursed - (w.deductions - w.wages) - w.wages)).toBe(w.netDue);
});

test('all 18 read: the sums of what the reader shows are the workbook totals', () => {
  const totals = { revenue: 0, deposited: 0, profit: 0, miles: 0 };
  for (const w of PRIME_18_WEEKS) {
    const importDate = addDays(w.weekEnding, 1);
    const t = readThrough(printedFromWeek(w, { lines: w.weekEnding === '2026-08-28' ? LINES_0828 : undefined, wage: wageOf(w.weekEnding) }), {
      pages: w.pages,
      lastContentPage: w.lastContentPage,
      cashFlowPrinted: w.cashFlowPrinted,
      importDate,
    });
    const f = figuresOf(t.extraction!, importDate);
    totals.revenue = r2(totals.revenue + f.revenue);
    totals.deposited = r2(totals.deposited + f.deposited);
    totals.profit = r2(totals.profit + f.profit);
    totals.miles += f.miles ?? 0;
  }
  expect(totals).toEqual({ revenue: 88210.06, deposited: 39913.01, profit: 46232.73, miles: 32607 });
});
