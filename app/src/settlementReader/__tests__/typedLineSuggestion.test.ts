// 08/28 DEVICE TEST, finding 2 (owner 2026-11-13): the owner left the typed
// line at 0.00 and certified; the week saved with profit 436.49 instead of
// 436.04 (the 0.45 stayed inside expenses). The printed block derives the
// value: ACCRUAL PERFORMANCE BOND 100.00- and TOTAL OTHER INCOME AND EXPENSE
// 99.55- leave 0.45. It is suggested, and a contradicting amount is refused.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from './fixtures/printedReading';
import { figuresOf, readThrough } from './fixtures/runReader';
import { profitLineConflicts, profitLineSuggestions } from '@/src/import/primeStatementTemplate';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { afterAnswers } from '../machine';

const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-08-28')!;
const LABEL = 'INTEREST INCOME FROM DEPOSIT';

// The interest row not read at all; TOTAL OTHER INCOME AND EXPENSE 99.55- read.
function interestNotRead() {
  const r = printedFromWeek(w, { lines: LINES_0828 });
  const tr = readThrough({ ...r, statement: { ...r.statement, rows: r.statement.rows.filter((x) => !/^INTEREST/.test(x.label)) } }, { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
  return tr;
}

test('the card asks for the line and suggests 0.45 from the printed block', () => {
  const tr = interestNotRead();
  expect(tr.progress.state).toBe('needs_input');
  expect(tr.progress.questions).toEqual([{ label: LABEL, printed: LABEL }]);
  expect(profitLineSuggestions(sanitizeExtraction(tr.extraction!))).toEqual([{ label: LABEL, amount: 0.45, total: 'TOTAL OTHER INCOME AND EXPENSE', printedTotal: -99.55 }]);
});

test('0.00 contradicts the printed block: named, and the server keeps waiting', () => {
  const tr = interestNotRead();
  const e = sanitizeExtraction(tr.extraction!);
  expect(profitLineConflicts(e, [{ label: LABEL, amount: 0 }])).toEqual([{ label: LABEL, amount: 0.45, total: 'TOTAL OTHER INCOME AND EXPENSE', printedTotal: -99.55, typed: 0 }]);
  const next = afterAnswers(tr.progress, tr.extraction!, [{ label: LABEL, amount: 0 }], { importDate: '2026-08-29' })!;
  expect(next.progress.state).toBe('needs_input');
  expect(next.progress.questions).toEqual(tr.progress.questions);
});

test('the suggested 0.45 is accepted: ready, profit 436.04', () => {
  const tr = interestNotRead();
  expect(profitLineConflicts(sanitizeExtraction(tr.extraction!), [{ label: LABEL, amount: 0.45 }])).toEqual([]);
  const next = afterAnswers(tr.progress, tr.extraction!, [{ label: LABEL, amount: 0.45 }], { importDate: '2026-08-29' })!;
  expect(next.progress.state).toBe('ready');
  expect(figuresOf(next.extraction!, '2026-08-29')).toMatchObject({ status: 'pass', profit: 436.04 });
});

test('two questions in one block: no suggestion, nothing refused (the gap cannot be split)', () => {
  const r = printedFromWeek(w, { lines: LINES_0828 });
  const rows = r.statement.rows.filter((x) => !/^INTEREST|^ACCRUAL/.test(x.label));
  const tr = readThrough({ ...r, statement: { ...r.statement, rows } }, { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
  const e = sanitizeExtraction(tr.extraction!);
  expect(profitLineSuggestions(e)).toEqual([]);
  expect(profitLineConflicts(e, [{ label: LABEL, amount: 0 }])).toEqual([]);
});
