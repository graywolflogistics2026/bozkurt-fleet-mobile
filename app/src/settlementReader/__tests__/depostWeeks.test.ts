// ROUND 2, item A (owner 2026-11-13, device): the scanned weeks 07/24, 08/21,
// 08/28 and 09/18 print "INTEREST INCOME FROM DEPOST" and the card asked
// for "INTEREST INCOME FROM DEPOSIT" (estimate off by 0.07 / 0.37 / 0.45 /
// 0.67). Read through the reader with the misspelled label as printed:
// the line is read, the week is ready, no card.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from './fixtures/printedReading';
import { addDays, figuresOf, readThrough } from './fixtures/runReader';
import type { ReadStatementRow } from '../schema';

const misspelled = (rows: ReadStatementRow[]) => rows.map((r) => (r.label === 'INTEREST INCOME FROM DEPOSIT' ? { ...r, label: 'INTEREST INCOME FROM DEPOST' } : r));

test.each([
  ['2026-07-24', 0.07],
  ['2026-08-21', 0.37],
  ['2026-08-28', 0.45],
  ['2026-09-18', 0.67],
])('%s (scanned, DEPOST): the interest line %p is read, ready, no card, the workbook profit', (iso, interest) => {
  const w = PRIME_13_WEEKS.find((x) => x.weekEnding === iso)!;
  const reading = printedFromWeek(w, { lines: iso === '2026-08-28' ? LINES_0828 : undefined, statementOverride: misspelled });
  expect(reading.statement.rows.some((r) => r.label === 'INTEREST INCOME FROM DEPOST' && r.weeks === interest.toFixed(2))).toBe(true);
  const importDate = addDays(iso, 1);
  const t = readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
  expect(t.progress.state).toBe('ready');
  expect(t.progress.questions).toEqual([]);
  expect(t.extraction!.settlement!.operating!.lines!.some((l) => l.label === 'INTEREST INCOME FROM DEPOST' && l.amount === interest)).toBe(true);
  expect(figuresOf(t.extraction!, importDate)).toMatchObject({ status: 'pass', profit: w.profit, deposited: w.deposited, owedToCarrier: w.owedToCarrier });
});

test('a label cut short by its column is the one known label it starts (prefix), never a guess', () => {
  const { canonicalStatementLabel } = jest.requireActual('@/src/import/primeStatementLines') as typeof import('@/src/import/primeStatementLines');
  expect(canonicalStatementLabel('INTEREST INCOME FROM DEP')).toBe('INTEREST INCOME FROM DEPOSIT');
  expect(canonicalStatementLabel('INTEREST INCOME FROM DEPOST')).toBe('INTEREST INCOME FROM DEPOSIT');
  expect(canonicalStatementLabel('TRACTOR FUEL DIS')).toBe('TRACTOR FUEL DISCOUNT');
  // Two known labels start this way: left as read.
  expect(canonicalStatementLabel('INTEREST INC')).toBe('INTEREST INC');
});
