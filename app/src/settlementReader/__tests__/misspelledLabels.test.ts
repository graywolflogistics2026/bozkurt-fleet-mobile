// 08/28 DEVICE TEST (owner 2026-11-13): the card asked the owner to type
// "INTEREST INCOME FROM DEPOSIT" although the statement prints it — as
// "INTEREST INCOME FROM DEPOST" (Prime's own misspelling), 0.45. The read
// label was compared letter for letter with the template label, so the
// row's block could not be found and the OTHER INCOME AND EXPENSE block
// did not add up -> the card asked; left at 0, profit 436.49 instead of
// 436.04. Every label comparison now goes through canonicalStatementLabel().
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from './fixtures/printedReading';
import { figuresOf, readThrough } from './fixtures/runReader';
import { canonicalStatementLabel, classifyStatementLine } from '@/src/import/primeStatementLines';
import { profitLinesToAsk } from '@/src/import/primeStatementTemplate';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { CONTENT_PROMPT } from '../prompt';
import type { ReadStatementRow } from '../schema';

const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-08-28')!;
const DEPOST = 'INTEREST INCOME FROM DEPOST';

describe('canonicalStatementLabel', () => {
  test.each([
    ['INTEREST INCOME FROM DEPOST', 'INTEREST INCOME FROM DEPOSIT'],
    ['Interest Income From Deposit', 'INTEREST INCOME FROM DEPOSIT'],
    ['INTEREST INCOME FRM DEPOSIT', 'INTEREST INCOME FROM DEPOSIT'],
    ['ACCRUAL PERFORMANCE BND', 'ACCRUAL PERFORMANCE BOND'],
    ['PRIME POINT-OF-SALE', 'PRIME POINT OF SALE'],
    ['START UP & EXCESS MILEAGE COST', 'START UP EXCESS MILEAGE COST'],
    // Exact known labels stay themselves (closest known pair differs by 3).
    ['TRACTOR FUEL DISCOUNT', 'TRACTOR FUEL DISCOUNT'],
    ['TRACTOR DEF', 'TRACTOR DEF'],
    ['REEFER FUEL', 'REEFER FUEL'],
    // Unknown labels are never guessed into a known one.
    ['DETENTION', 'DETENTION'],
    ['TRAINING DRIVER', 'TRAINING DRIVER'],
    ['TIRES', 'TIRES'],
  ])('%s -> %s', (label, expected) => {
    expect(canonicalStatementLabel(label)).toBe(expected);
  });

  test('the misspelling is classified like the label (interest income, excluded)', () => {
    expect(classifyStatementLine({ section: 'other', label: DEPOST })).toEqual({ treatment: { kind: 'exclude', reason: 'interest_income' }, unknown: false });
  });

  test('the prompt tells the model to copy a misspelled label as printed', () => {
    expect(CONTENT_PROMPT).toContain('even when it is misspelled');
    expect(CONTENT_PROMPT).toContain(DEPOST);
  });
});

describe('08/28 with Prime\'s printed DEPOST: the line reads 0.45, no typed-lines card', () => {
  const withDepost = (rows: ReadStatementRow[], afterTotal: boolean): ReadStatementRow[] => {
    const i = rows.findIndex((x) => /^INTEREST/.test(x.label));
    const row = { ...rows[i], label: DEPOST };
    if (!afterTotal) return rows.map((x, k) => (k === i ? row : x));
    const rest = rows.filter((_, k) => k !== i);
    rest.splice(rest.findIndex((x) => /TOTAL OTHER/.test(x.label)) + 1, 0, row);
    return rest;
  };

  test.each([
    ['printed in its block', false],
    ['read after the block total (the device case: before the fix this asked and gave 436.49)', true],
  ])('%s', (_name, afterTotal) => {
    const r = printedFromWeek(w, { lines: LINES_0828 });
    const tr = readThrough({ ...r, statement: { ...r.statement, rows: withDepost(r.statement.rows, afterTotal) } }, { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
    expect(tr.progress.state).toBe('ready');
    expect(tr.progress.questions).toEqual([]);
    expect(profitLinesToAsk(sanitizeExtraction(tr.extraction!))).toEqual([]);
    const line = (tr.extraction!.settlement!.operating!.lines ?? []).find((l) => l.label === DEPOST);
    expect(line).toMatchObject({ section: 'other', amount: 0.45 });
    expect(figuresOf(tr.extraction!, '2026-08-29')).toMatchObject({ status: 'pass', profit: 436.04 });
  });
});
