// THE GOLDEN WEEKS THROUGH THE NEW READER (owner decision 2026-11-13).
// Every week of the owner's 13-week workbook (prime13Weeks.ts, real printed
// totals) is printed as the content call would return it, read by the
// reader (range -> one read -> the one gate) and must show the workbook's
// figures: net due, gross due, deposited, owed, real expenses, profit,
// miles, bond held, YTD revenue and YTD paid.
import { PRIME_13_TOTALS, PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { LINES_0828, printedFromExtraction, printedFromWeek } from './fixtures/printedReading';
import { addDays, figuresOf, readThrough } from './fixtures/runReader';
import { golden0717, KEY as KEY0717 } from '@/src/data/__tests__/golden0717Fixture';
import { golden0814, KEY as KEY0814 } from '@/src/data/__tests__/golden0814Fixture';
import { LINES_PAGE_5, LINES_PAGE_6 } from '@/src/import/__tests__/golden0821Pages';
import type { PrintedLine } from './fixtures/printedReading';

const week = (iso: string) => PRIME_13_WEEKS.find((w) => w.weekEnding === iso)!;

describe('13 golden weeks through the new reader', () => {
  test('the workbook ties (13-week totals)', () => {
    expect(PRIME_13_TOTALS).toEqual({ revenue: 58772.17, deposited: 26463.71, profit: 32221.06, miles: 22286 });
    for (const w of PRIME_13_WEEKS) {
      expect([w.weekEnding, w.bridge, w.ytdRevenueDiff, w.ytdPaidDiff]).toEqual([w.weekEnding, 0, 0, 0]);
    }
  });

  test.each(PRIME_13_WEEKS.map((w) => [w.weekEnding, w] as const))('%s: ready, and every figure is the workbook\'s', (_iso, w) => {
    const lines = w.weekEnding === '2026-08-28' ? LINES_0828 : undefined;
    const importDate = addDays(w.weekEnding, 1);
    const result = readThrough(printedFromWeek(w, { lines }), { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
    expect(result.progress.state).toBe('ready');
    expect(result.status).toBe('ready');
    const f = figuresOf(result.extraction!, importDate);
    expect(f).toEqual({
      status: 'pass',
      revenue: w.revenue,
      netDue: w.netDue,
      deposited: w.deposited,
      owedToCarrier: w.owedToCarrier,
      expenses: w.realExpense,
      profit: w.profit,
      miles: w.miles > 0 ? w.miles : null,
      bondHeld: w.bondHeld,
      ytdRevenue: w.ytdRevenue,
      ytdPaid: w.ytdPaid,
    });
    // Gross due (SETTLEMENT GROSS DUE) = net due + balance forward + interest.
    expect(Math.round((w.netDue + w.balanceForward + w.interestIncome - w.interestExpense) * 100) / 100).toBe(w.grossDue);
  });
});

describe('the owner\'s contract numbers (2026-11-13)', () => {
  const run = (iso: string, lines?: PrintedLine[]) => {
    const w = week(iso);
    const importDate = addDays(iso, 1);
    const t = readThrough(printedFromWeek(w, { lines }), { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
    return figuresOf(t.extraction!, importDate);
  };
  test('07/17: profit -293.62, card payout 317.42', () => {
    expect(run('2026-07-17')).toMatchObject({ profit: -293.62, deposited: 317.42 });
  });
  test('08/14: profit 4,987.74, deposit 3,072.57', () => {
    expect(run('2026-08-14')).toMatchObject({ profit: 4987.74, deposited: 3072.57 });
  });
  test('08/21: profit 2,533.36, deposit 1,884.73', () => {
    expect(run('2026-08-21')).toMatchObject({ profit: 2533.36, deposited: 1884.73 });
  });
  test('08/28: owed 213.51, deposited 0, profit 436.04, bond held 700', () => {
    expect(run('2026-08-28', LINES_0828)).toMatchObject({ owedToCarrier: 213.51, deposited: 0, profit: 436.04, bondHeld: 700, ytdRevenue: 24617.38, ytdPaid: 8099.66 });
  });
});

describe('golden weeks with their real transcribed lines', () => {
  test('07/17 (transcribed fixture): card payout, no cash-flow section, statement on pages 4-5', () => {
    const reading = printedFromExtraction(golden0717(), { cashFlow: false, pageOf: (s) => (s === 'revenue' || s === 'fuel_oil_tax' || s === 'repair' ? 4 : 5) });
    const t = readThrough(reading, { pages: 8, lastContentPage: 5, cashFlowPrinted: false, importDate: '2026-07-18' });
    expect(t.progress.state).toBe('ready');
    const f = figuresOf(t.extraction!, '2026-07-18');
    expect(f).toMatchObject({ status: 'pass', revenue: KEY0717.revenue, deposited: KEY0717.payout, profit: KEY0717.profit, expenses: KEY0717.expenses });
    expect(t.extraction!.settlement!.payoutMethod).toBe('card');
  });

  test('08/14 (transcribed fixture, 17 pages): deposit 3,072.57, profit 4,987.74', () => {
    const t = readThrough(printedFromExtraction(golden0814(), { cashFlow: true }), { pages: 17, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-15' });
    expect(t.progress.state).toBe('ready');
    expect(figuresOf(t.extraction!, '2026-08-15')).toMatchObject({ status: 'pass', revenue: KEY0814.revenue, deposited: KEY0814.deposit, profit: KEY0814.profit });
  });

  test('08/21 (transcribed statement lines of pages 5-6): profit 2,533.36, deposit 1,884.73', () => {
    const lines: PrintedLine[] = [
      ...LINES_PAGE_5.map((l) => ({ section: l.section as PrintedLine['section'], label: l.label, amount: l.amount, page: 5 })),
      ...LINES_PAGE_6.map((l) => ({ section: l.section as PrintedLine['section'], label: l.label, amount: l.amount, page: 6 })),
    ];
    const w = week('2026-08-21');
    const t = readThrough(printedFromWeek(w, { lines }), { pages: 8, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-22' });
    expect(t.progress.state).toBe('ready');
    expect(figuresOf(t.extraction!, '2026-08-22')).toMatchObject({ status: 'pass', revenue: 4783.75, deposited: 1884.73, profit: 2533.36, expenses: 2250.39 });
  });
});
