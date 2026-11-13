// "OKUYUCU NOTLARI" (owner workbook 2026-11-13): every case the reader must
// recognize is a named test. Each test reads a simulated document through
// the new reader (range -> one read -> the one gate) or checks the
// copy -> contract step directly.
import { PRIME_13_WEEKS, READER_NOTES } from './fixtures/prime13Weeks';
import { LINES_0828, classLines, printed, printedFromExtraction, printedFromWeek, type PrintedLine } from './fixtures/printedReading';
import { addDays, figuresOf, readThrough } from './fixtures/runReader';
import { golden0717 } from '@/src/data/__tests__/golden0717Fixture';
import { contentRange } from '../range';
import { placeStatementRows, readingToExtraction } from '../toExtraction';
import { primeRangeReply } from './fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { readPrimeEscrow } from '@/src/import/primeEscrow';
import type { ContentReading, ReadStatementRow } from '../schema';

const week = (iso: string) => PRIME_13_WEEKS.find((w) => w.weekEnding === iso)!;
const run = (iso: string, opts: { lines?: PrintedLine[]; rows?: (r: ReadStatementRow[]) => ReadStatementRow[] } = {}) => {
  const w = week(iso);
  const importDate = addDays(iso, 1);
  const reading = printedFromWeek(w, { lines: opts.lines, statementOverride: opts.rows });
  const t = readThrough(reading, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate });
  return { t, f: figuresOf(t.extraction!, importDate), reading };
};
const note = (i: number) => `${i + 1}. ${READER_NOTES[i].case} (${READER_NOTES[i].firstSeen})`;
const meta = { pagesTotal: 8, contentPages: [1, 2, 3, 4, 5, 6], attachmentPages: [] };

describe('Okuyucu notları: the 21 cases', () => {
  test('the workbook lists 21 cases', () => expect(READER_NOTES).toHaveLength(21));

  test(note(0), () => {
    const { t, f } = run('2026-07-17');
    expect(t.extraction!.settlement!.payoutMethod).toBe('card');
    expect(t.extraction!.settlement!.totalLabels!.depositAmount).toBe('AMOUNT LOADED ON CARD');
    expect(f.deposited).toBe(317.42);
  });

  test(note(1), () => {
    for (const iso of ['2026-07-17', '2026-07-24']) {
      const w = week(iso);
      expect(w.cashFlowPrinted).toBe(false);
      const range = contentRange(primeRangeReply(w.pages, w.lastContentPage, false), w.pages);
      expect(range.ok && range.range.lastContentPage).toBe(w.lastContentPage);
      expect(run(iso).t.progress.state).toBe('ready');
    }
  });

  test(note(2), () => {
    for (const [iso, owed] of [['2026-07-24', 1155.28], ['2026-08-07', 1202.92], ['2026-08-28', 213.51]] as const) {
      const { t, f, reading } = run(iso, iso === '2026-08-28' ? { lines: LINES_0828 } : {});
      expect(reading.summary.some((r) => /DIRECT DEPOSIT|CARD/.test(r.label))).toBe(false);
      expect(t.progress.state).toBe('ready');
      expect([iso, f.deposited, f.owedToCarrier]).toEqual([iso, 0, owed]);
    }
  });

  test(note(3), () => {
    const { f, t } = run('2026-07-31');
    expect(t.extraction!.settlement!.operating!.priorWeekBalanceForward).toBe(-1155.28);
    expect(f).toMatchObject({ deposited: 2824.94, expenses: 3605.25, profit: 4630.22 });
  });

  test(note(4), () => {
    // A row whose WEEKS cell is blank while YTD and LTD are printed: not
    // counted, and nothing slips into WEEKS.
    const { t, f } = run('2026-07-24', {
      rows: (rows) => {
        const at = rows.findIndex((r) => r.label === 'TOTAL REVENUE');
        return [...rows.slice(0, at), { page: 5, label: 'FUEL SURCG BILL', weeks: '', ytd: '173.55', ltd: '173.55' }, ...rows.slice(at)];
      },
    });
    const lines = t.extraction!.settlement!.operating!.lines!;
    expect(lines.some((l) => l.label === 'FUEL SURCG BILL')).toBe(false);
    expect(f).toMatchObject({ status: 'pass', revenue: 5.16 });
  });

  test(note(5), () => {
    for (const iso of ['2026-07-24', '2026-08-28']) {
      const { t, f } = run(iso, iso === '2026-08-28' ? { lines: LINES_0828 } : {});
      expect(week(iso).miles).toBe(0);
      expect(t.progress.state).toBe('ready');
      expect(f.miles).toBe(0);
      expect(t.extraction!.settlement!.milesLines).toContainEqual({ label: 'TOTAL MILES', miles: 0 });
    }
  });

  test(note(6), () => {
    const golden = printedFromExtraction(golden0717(), { cashFlow: false });
    const misc = golden.statement.rows.find((r) => r.label === 'TOTAL MISCELLANEOUS')!;
    expect(misc.weeks).toBe('10.68');
    const { t, f } = run('2026-08-28', { lines: LINES_0828 });
    expect(t.extraction!.settlement!.operating!.totalLines).toContainEqual(expect.objectContaining({ label: 'TOTAL FIXED COST', amount: 269.23 }));
    expect(f.profit).toBe(436.04);
  });

  test(note(7), () => {
    const { t, f } = run('2026-08-28', { lines: LINES_0828 });
    const lines = t.extraction!.settlement!.operating!.lines!;
    expect(lines.find((l) => l.label === 'LICENSE AND PERMITS')!.amount).toBe(225);
    expect(lines.find((l) => l.label === 'FEDERAL HWY TAX')!.amount).toBe(200);
    expect(f.expenses).toBe(-244.64);
  });

  test(note(8), () => {
    const placed = placeStatementRows(printedFromExtraction(golden0717(), { cashFlow: false }).statement.rows);
    const misc = placed.filter((p) => p.section === 'misc');
    expect(misc.find((p) => p.label === 'MISCELLANEOUS')).toMatchObject({ kind: 'line', weeksValue: -6.5 });
    expect(misc.find((p) => p.label === 'TOTAL MISCELLANEOUS')).toMatchObject({ kind: 'total', weeksValue: 10.68 });
  });

  test(note(9), () => {
    // 07/17: the misc block starts on page 4 and ends on page 5.
    const reading = printedFromExtraction(golden0717(), { cashFlow: false, pageOf: (s) => (s === 'revenue' || s === 'fuel_oil_tax' || s === 'repair' ? 4 : 5) });
    const rows = reading.statement.rows.map((r) => (r.label === 'ADVANCES' || r.label === 'PERSONAL PYMNT RCV' ? { ...r, page: 4 } : r));
    const t = readThrough({ ...reading, statement: { ...reading.statement, rows } }, { pages: 8, lastContentPage: 5, cashFlowPrinted: false, importDate: '2026-07-18' });
    const misc = t.extraction!.settlement!.operating!.lines!.filter((l) => l.section === 'misc');
    expect(new Set(misc.map((l) => l.page))).toEqual(new Set([4, 5]));
    expect(figuresOf(t.extraction!, '2026-07-18')).toMatchObject({ status: 'pass', profit: -293.62 });
  });

  test(note(10), () => {
    const e = readingToExtraction(printedFromExtraction(golden0717(), { cashFlow: false }), meta);
    expect(e.settlement!.reimbursementItems!.map((r) => r.code)).toEqual(['PR', 'WA', 'WA', 'RF']);
    expect(figuresOf(e, '2026-07-18').profit).toBe(-293.62);
  });

  test(note(11), () => {
    for (const [iso, amount] of [['2026-07-17', 7020], ['2026-08-07', 980]] as const) {
      const { t, f } = run(iso);
      expect(t.extraction!.settlement!.operating!.lines!.find((l) => l.label === 'OPERATOR TRK EXTRAS')!.amount).toBe(-amount);
      expect(f.profit).toBe(week(iso).profit);
    }
  });

  test(note(12), () => {
    const { t, f } = run('2026-08-21');
    expect(t.extraction!.settlement!.operating!.lines!.find((l) => l.label === 'PERSONAL PYMNT RCV')!.amount).toBe(1);
    expect(f.profit).toBe(2533.36);
  });

  test(note(13), () => {
    const placed = placeStatementRows(printedFromWeek(week('2026-08-28'), { lines: LINES_0828 }).statement.rows);
    expect(placed.find((p) => p.label === 'DETENTION')).toMatchObject({ kind: 'line', section: 'revenue', weeksValue: 189 });
    expect(run('2026-08-28', { lines: LINES_0828 }).f.revenue).toBe(191.4);
  });

  test(note(14), () => {
    const w = week('2026-09-18');
    const lines = [...classLines(w)];
    lines[0] = { ...lines[0], amount: Math.round((lines[0].amount - 100) * 100) / 100 };
    lines.splice(1, 0, { section: 'revenue', label: 'TRAINING DRIVER', amount: 100 });
    const { t, f } = run('2026-09-18', { lines });
    expect(t.extraction!.settlement!.operating!.lines!.find((l) => l.label === 'TRAINING DRIVER')).toMatchObject({ section: 'revenue', amount: 100 });
    expect(f.revenue).toBe(w.revenue);
    expect(f.profit).toBe(w.profit);
  });

  test(note(15), () => {
    const rows: ReadStatementRow[] = ['WEIGHT TICKETS', 'PREPASS WEIGH STATION', 'TRAILER WASH'].map((label) => ({ page: 5, label, weeks: '1.00-', ytd: '', ltd: '' }));
    rows.unshift({ page: 5, label: 'UNIT REPAIR EXPENSE', weeks: '10.00-', ytd: '', ltd: '' });
    const placed = placeStatementRows(rows);
    expect(placed.map((p) => p.section)).toEqual(['repair', 'misc', 'misc', 'misc']);
  });

  test(note(16), () => {
    // Accounts page "1,155.28" (unsigned), statement "1,155.28-": the sign
    // comes from the statement's cash-flow row.
    const { t } = run('2026-07-31');
    expect(t.extraction!.settlement!.operating!.recapLines).toContainEqual(expect.objectContaining({ label: 'PRIOR WEEK BALANCE FORWARD', weeks: -1155.28 }));
    expect(figuresOf(t.extraction!, '2026-08-01').deposited).toBe(2824.94);
  });

  test(note(17), () => {
    for (const rate of ['3.79%', '3.83%', '3.86%', '4.11%']) {
      const reading = printedFromWeek(week('2026-08-14'));
      const e = readingToExtraction({ ...reading, accounts: reading.accounts.map((a) => ({ ...a, ratePct: rate })) }, meta);
      expect(e.settlement!.operating!.escrowInterestRatePct).toBe(Number(rate.replace('%', '')));
    }
    expect(readPrimeEscrow(sanitizeExtraction(readingToExtraction(printedFromWeek(week('2026-08-14')), meta)))?.held).toBe(500);
  });

  test(note(18), () => {
    for (const w of PRIME_13_WEEKS) {
      const r = contentRange(primeRangeReply(w.pages, w.lastContentPage, w.cashFlowPrinted), w.pages);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect([w.weekEnding, r.range.lastContentPage, r.range.attachmentPages.length + r.range.attachmentsNotRead]).toEqual([w.weekEnding, w.lastContentPage, w.pages - w.lastContentPage]);
    }
  });

  test(note(19), () => {
    // 10/09: another PDF producer, no creation date: nothing depends on it.
    const { t, f } = run('2026-10-09');
    expect(t.extraction!.pdfCreationDate).toBeUndefined();
    expect(f).toMatchObject({ status: 'pass', profit: 5867.8, deposited: 5768.75 });
  });

  test(note(20), () => {
    // MILES: only the WEEKS column is the week; QTD/YTD/LTD never are.
    const { t, f } = run('2026-10-09', {
      rows: (rows) => rows.map((r) => (r.label === 'MILES' ? { ...r, ytd: '3,322.00', ltd: '22,286.00' } : r)),
    });
    expect(t.extraction!.settlement!.operating!.weekMiles).toBe(3322);
    expect(t.extraction!.settlement!.operating!.ytdMiles).toBe(3322);
    expect(f.miles).toBe(3322);
    expect(printed(22286)).toBe('22,286.00');
  });
});
