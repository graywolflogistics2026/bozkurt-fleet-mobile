// WASTED READS, THE SIGN (owner 2026-11-13, device build 664be90): 07/17 and
// 11/06 failed with printed -9232.02 / read 9232.02 and printed -2174.54 /
// read 2174.54, and BOTH reads were billed ($0.3633, $0.4497) for the same
// deterministic failure. Same size with the opposite sign is our rule
// problem: failed after read 1, no second read, not counted, a message that
// says so.
import { chargedReads, explainMismatch } from '../machine';
import { readerFailureLines, readerReportLines } from '@/src/import/readerJob';
import { PRIME_18_WEEKS } from './fixtures/prime18Weeks';
import { printedFromWeek, WAGES_1106 } from './fixtures/printedReading';
import { readThrough } from './fixtures/runReader';
import en from '@/src/i18n/locales/en.json';

const week = (iso: string) => PRIME_18_WEEKS.find((w) => w.weekEnding === iso)!;
const lookup = (key: string, opts: Record<string, unknown> = {}) => {
  const v = key.split('.').reduce<any>((o, k) => o?.[k], en) as string | undefined;
  return (v ?? String(opts.defaultValue ?? key)).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
};

test.each([
  ['2026-07-17', -9232.02, 9232.02],
  ['2026-11-06', -2174.54, 2174.54],
])('%s: the device failure (printed %s, read %s) is a sign rule gap naming the recap row', (iso, printed, read) => {
  const w = week(iso);
  const r = printedFromWeek(w, { wage: iso === '2026-11-06' ? WAGES_1106 : undefined });
  const gap = explainMismatch(r, { reason: 'net_due_differs', details: [{ check: 'deductionsFromSettlements', printed, read }] });
  expect(gap).toMatchObject({ kind: 'sign', check: 'deductionsFromSettlements', label: 'TOTAL DEDUCTIONS FROM SETTLEMENTS', amount: read });
});

test('a net due read with the opposite sign: failed after ONE read, not charged, no second read, a sign message', () => {
  const w = week('2026-07-17');
  const r = printedFromWeek(w);
  const flipped = { ...r, summary: r.summary.map((s) => (s.label === 'NET AMOUNT DUE UNIT' ? { ...s, amount: `${s.amount}-` } : s)) };
  const t = readThrough(flipped, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate: '2026-07-18' });
  expect(t.progress.state).toBe('failed');
  expect(t.progress.readsStarted).toBe(1);
  expect(chargedReads(t.progress)).toBe(0);
  expect(t.progress.failure).toMatchObject({ reason: 'rule_gap', ruleGap: { kind: 'sign', label: 'NET AMOUNT DUE UNIT', amount: 317.42 } });
  const lines = readerFailureLines({ state: 'failed', failure: t.progress.failure!, reads: 0, readAgain: null, sameResult: false } as never, lookup, (v) => String(v));
  expect(lines[0]).toBe('The printed NET AMOUNT DUE UNIT -317.42 and our reading 317.42 differ only by sign. Your document is fine: our sign rule is wrong. This read was not counted and there is no second read.');
  const report = readerReportLines({ status: 'failed', createdAt: '2026-07-18T10:00:00Z', reader: t.progress } as never);
  expect(report.some((l) => l.startsWith('Rule gap: sign'))).toBe(true);
});

test('a real misread (different size) still reads again', () => {
  const w = week('2026-07-17');
  const r = printedFromWeek(w);
  const misread = { ...r, summary: r.summary.map((s) => (s.label === 'NET AMOUNT DUE UNIT' ? { ...s, amount: '371.42' } : s)) };
  const t = readThrough(misread, { pages: w.pages, lastContentPage: w.lastContentPage, cashFlowPrinted: w.cashFlowPrinted, importDate: '2026-07-18' });
  expect(t.progress.state).toBe('reading');
  expect(t.progress.lastReadCause).toBe('auto');
});
