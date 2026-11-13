// 07/17 DEVICE TEST (owner 2026-11-13): the first real import failed with
// "We could not find Prime's Statement of Income and Expense ..." after 2
// reads, with no check name and no numbers. 07/17 prints NO cash-flow
// section: its statement (pages 4-5 of 8) ends at TOTAL STATEMENT OF INCOME
// & EXPENSE, and its payout reads AMOUNT LOADED ON CARD.
//
// Cause (reproduced here through the REAL range detection, the real mapper,
// the real state machine and the real gate):
//   1. The content prompt told the model the statement rows end at "TOTAL
//      STATEMENT OF INCOME & EXPENSE, or TOTAL CASH FLOW and the rows after
//      it": on a week without a cash-flow section the rows printed after
//      TOTAL STATEMENT (SETTLEMENT TO OPERATOR, the card payout) were not
//      copied.
//   2. The gate then REQUIRED SETTLEMENT TO OPERATOR on a positive week
//      (primeGateMissing): a missing printed line failed the week instead of
//      skipping its check -> statement_not_read, failures
//      ['settlementToOperator'], which the failure screen never showed.
//   3. Both reads failed the same way and both counted against the owner.
// The other no-cash-flow week, 07/24 (negative, statement on page 6 of 8),
// is run the same way.
import { PRIME_13_WEEKS } from './fixtures/prime13Weeks';
import { printedFromExtraction, printedFromWeek } from './fixtures/printedReading';
import { figuresOf } from './fixtures/runReader';
import { golden0717, KEY as KEY0717 } from '@/src/data/__tests__/golden0717Fixture';
import { normalizeStatementLabel } from '@/src/import/primeStatementLines';
import { readerFailureLines, readerJobView } from '@/src/import/readerJob';
import { CONTENT_PROMPT } from '../prompt';
import { afterContent, afterRange, canReadAgain, chargedReads, newReaderProgress, readAgain, startContentRead, type ReaderProgress, type Transition } from '../machine';
import { contentRange } from '../range';
import type { ContentReading, RangeReply } from '../schema';
import en from '@/src/i18n/locales/en.json';

const t = (key: string, opts: Record<string, unknown> = {}): string => {
  const raw = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
  const text = typeof raw === 'string' ? raw : typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

// What the range call says about 07/17: settlement, accounts, recap,
// statement on 4-5 (TOTAL STATEMENT on 5, no TOTAL CASH FLOW anywhere),
// then three attachment pages.
const RANGE_0717: RangeReply = {
  carrier: 'PRIME INC.',
  isSettlement: true,
  pages: [
    { page: 1, kind: 'settlement', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 2, kind: 'accounts', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 3, kind: 'recap', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 4, kind: 'statement', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 5, kind: 'statement', hasTotalCashFlow: false, hasTotalStatement: true },
    { page: 6, kind: 'attachment', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 7, kind: 'attachment', hasTotalCashFlow: false, hasTotalStatement: false },
    { page: 8, kind: 'attachment', hasTotalCashFlow: false, hasTotalStatement: false },
  ],
};
const RANGE_0724: RangeReply = {
  carrier: 'PRIME INC.',
  isSettlement: true,
  pages: Array.from({ length: 8 }, (_, i) => {
    const page = i + 1;
    return { page, kind: page <= 3 ? 'settlement' : page <= 4 ? 'recap' : page <= 6 ? 'statement' : 'attachment', hasTotalCashFlow: false, hasTotalStatement: page === 6 } as RangeReply['pages'][number];
  }),
};

function readTwice(range: RangeReply, pages: number, reading: ContentReading, importDate: string): Transition {
  const r = contentRange(range, pages);
  let p: ReaderProgress = afterRange(newReaderProgress(pages, importDate), { ok: true, value: r }).progress;
  let tr: Transition | null = null;
  for (let i = 0; i < 2 && p.state === 'reading' && p.step === 'content'; i++) {
    p = startContentRead(p)!;
    tr = afterContent(p, { ok: true, value: reading }, { importDate });
    p = tr.progress;
  }
  return tr!;
}

const reading0717 = () => printedFromExtraction(golden0717(), { cashFlow: false, pageOf: (s) => (s === 'revenue' || s === 'fuel_oil_tax' || s === 'repair' ? 4 : 5) });
// What the model copied on the device: the rows stop at TOTAL STATEMENT.
const stopAtTotalStatement = (r: ContentReading): ContentReading => {
  const rows = r.statement.rows;
  const end = rows.findIndex((x) => /^TOTAL STATEMENT\b/.test(normalizeStatementLabel(x.label)));
  return { ...r, statement: { ...r.statement, rows: rows.slice(0, end + 1) } };
};
// The payout printed after TOTAL STATEMENT instead of SETTLEMENT TO OPERATOR.
const cardPayoutOnly = (r: ContentReading): ContentReading => ({
  ...r,
  statement: {
    ...r.statement,
    rows: r.statement.rows.map((x) => (normalizeStatementLabel(x.label) === 'SETTLEMENT TO OPERATOR' ? { ...x, label: 'AMOUNT LOADED ON CARD' } : x)),
  },
});

describe('07/17 (no cash-flow section, statement on pages 4-5 of 8)', () => {
  test('the real range detection ends the content at TOTAL STATEMENT (page 5); 6-8 are attachments', () => {
    const r = contentRange(RANGE_0717, 8);
    expect(r).toEqual({ ok: true, range: expect.objectContaining({ lastContentPage: 5, statementFirst: 4, cashFlowPrinted: false, attachmentPages: [6, 7, 8] }) });
  });

  test.each([
    ['every row copied', reading0717()],
    ['rows stop at TOTAL STATEMENT (the device reading)', stopAtTotalStatement(reading0717())],
    ['payout row AMOUNT LOADED ON CARD, no SETTLEMENT TO OPERATOR', cardPayoutOnly(reading0717())],
  ])('%s: ready, with the owner\'s figures', (_name, reading) => {
    const tr = readTwice(RANGE_0717, 8, reading, '2026-07-18');
    expect(tr.progress.state).toBe('ready');
    expect(figuresOf(tr.extraction!, '2026-07-18')).toMatchObject({ status: 'pass', revenue: KEY0717.revenue, deposited: KEY0717.payout, profit: KEY0717.profit });
  });

  test('the statement week printed M/D/YY (07/17/26) is read, not called missing', () => {
    const r = reading0717();
    const tr = readTwice(RANGE_0717, 8, { ...r, statement: { ...r.statement, weekEndingRaw: '07/17/26' } }, '2026-07-18');
    expect(tr.progress.state).toBe('ready');
  });

  test('the prompt tells the model to copy the rows after TOTAL STATEMENT', () => {
    expect(CONTENT_PROMPT).toContain('Do not stop at TOTAL STATEMENT OF INCOME & EXPENSE');
    expect(CONTENT_PROMPT).toContain('AMOUNT LOADED ON CARD');
  });
});

describe('07/24 (negative, no cash-flow section, statement on page 6 of 8)', () => {
  const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-07-24')!;
  test('the real range detection ends the content at page 6', () => {
    expect(contentRange(RANGE_0724, 8)).toEqual({ ok: true, range: expect.objectContaining({ lastContentPage: 6, cashFlowPrinted: false, attachmentPages: [7, 8] }) });
  });
  test.each([
    ['every row copied', printedFromWeek(w)],
    ['rows stop at TOTAL STATEMENT', stopAtTotalStatement(printedFromWeek(w))],
  ])('%s: ready, owes 1,155.28', (_name, reading) => {
    const tr = readTwice(RANGE_0724, 8, reading, '2026-07-25');
    expect(tr.progress.state).toBe('ready');
    expect(figuresOf(tr.extraction!, '2026-07-25')).toMatchObject({ status: 'pass', owedToCarrier: 1155.28, deposited: 0, profit: w.profit });
  });
});

describe('a statement total really not read: named, and not charged to the owner', () => {
  // TOTAL STATEMENT's WEEKS cell blank (only YTD read) on both reads.
  const blankTotal = (r: ContentReading): ContentReading => ({
    ...r,
    statement: { ...r.statement, rows: r.statement.rows.map((x) => (/^TOTAL STATEMENT\b/.test(normalizeStatementLabel(x.label)) ? { ...x, weeks: '' } : x)) },
  });
  const tr = readTwice(RANGE_0717, 8, blankTotal(reading0717()), '2026-07-18');
  const job = { id: 'j', status: 'failed' as const, updatedAt: '2026-11-13T12:00:00Z', reader: tr.progress };

  test('failed, statement_not_read, totalStatement named', () => {
    expect(tr.progress.state).toBe('failed');
    expect(tr.progress.failure).toMatchObject({ reason: 'statement_not_read', failures: ['totalStatement'] });
  });

  test('the screen names the label and the pages, never only the generic sentence', () => {
    const view = readerJobView(job, '2026-11-13T12:00:00Z');
    if (view.state !== 'failed') throw new Error('expected failed');
    const lines = readerFailureLines(view, t);
    expect(lines[0]).toBe(en.importFlow.reason.statementNotRead);
    expect(lines).toContain('Not read: TOTAL STATEMENT OF INCOME & EXPENSE (looked for on pages 4–5).');
    expect(lines.join('\n')).not.toContain('already read 2 times');
  });

  test('both reads failed for our reason: 0 charged, Read again stays available (hard cap 4)', () => {
    expect(tr.progress.readsStarted).toBe(2);
    expect(chargedReads(tr.progress)).toBe(0);
    expect(canReadAgain(tr.progress)).toBe(true);
    const again = readAgain(tr.progress)!.progress;
    expect(startContentRead(again)?.readsStarted).toBe(3);
    expect(canReadAgain({ ...tr.progress, readsStarted: 4 })).toBe(false);
  });

  test('a misread number or a model error still counts against the 2 reads', () => {
    const p: ReaderProgress = {
      ...tr.progress,
      readsStarted: 2,
      failure: { reason: 'gross_differs' },
      reads: [
        { n: 1, signature: 'a', outcome: 'failed', reason: 'gross_differs' },
        { n: 2, signature: 'b', outcome: 'model_failed', reason: 'timeout' },
      ],
    };
    expect(chargedReads(p)).toBe(2);
    expect(canReadAgain(p)).toBe(false);
  });
});
