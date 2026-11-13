// ROUND 2, item H (owner 2026-11-13, device 11/06): both reads were used and
// billed ($0.4998) for a mismatch whose difference (805.50) is a printed
// total of the same document. Before a second read the reader explains the
// mismatch from the values already read: a difference equal to another
// printed total or line is our rule problem — no second read, not counted
// against the owner's reads, a specific message.
import { chargedReads, explainMismatch } from '../machine';
import { readerFailureLines } from '@/src/import/readerJob';
import { PRIME_18_WEEKS } from './fixtures/prime18Weeks';
import { printedFromWeek, WAGES_1106 } from './fixtures/printedReading';
import { readThrough } from './fixtures/runReader';
import type { ContentReading } from '../schema';
import en from '@/src/i18n/locales/en.json';

const w1106 = PRIME_18_WEEKS.find((w) => w.weekEnding === '2026-11-06')!;
const run = (reading: ContentReading) => readThrough(reading, { pages: 11, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-11-07' });

// The wage total printed under a label our rules do not know.
function unknownWageLabel(): ContentReading {
  const r = printedFromWeek(w1106, { wage: WAGES_1106 });
  return {
    ...r,
    settlementLines: [],
    summary: r.summary.filter((s) => !/WAGE|FROM SETTLEMENTS/.test(s.label)).concat({ page: 2, label: 'TOTAL PAYROLL WITHHELD', amount: '805.50' }),
  };
}

const lookup = (key: string, opts: Record<string, unknown> = {}) => {
  const v = key.split('.').reduce<any>((o, k) => o?.[k], en) as string | undefined;
  return (v ?? String(opts.defaultValue ?? key)).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
};

test('the difference equals a printed total: failed as our rule gap, no second read, not counted', () => {
  const t = run(unknownWageLabel());
  expect(t.progress.state).toBe('failed');
  expect(t.progress.step).toBe('done');
  expect(t.progress.readsStarted).toBe(1);
  expect(chargedReads(t.progress)).toBe(0);
  expect(t.progress.failure).toMatchObject({
    reason: 'rule_gap',
    check: 'netDueMismatch',
    printed: 425.47,
    read: 1230.97,
    ruleGap: { check: 'netDueMismatch', difference: 805.5, label: 'TOTAL PAYROLL WITHHELD', amount: 805.5 },
  });
  const lines = readerFailureLines({ state: 'failed', failure: t.progress.failure!, reads: 0, readAgain: null, sameResult: false } as never, lookup, (v) => String(v));
  expect(lines[0]).toBe('The difference 805.5 equals the printed TOTAL PAYROLL WITHHELD. Your document is fine: our reading rule missed it. This read was not counted.');
  expect(lines).toContain('NET AMOUNT DUE UNIT: printed 425.47, read 1230.97');
  expect(lines.join(' ')).not.toMatch(/reads used/i);
});

test('a real misread (the difference is no printed figure) still reads again automatically', () => {
  const r = printedFromWeek(w1106, { wage: WAGES_1106 });
  const misread = { ...r, summary: r.summary.map((s) => (s.label === 'TOTAL REV' ? { ...s, amount: '2,543.68' } : s)) };
  const t = run(misread);
  expect(t.progress.state).toBe('reading');
  expect(t.progress.step).toBe('content');
  expect(t.progress.lastReadCause).toBe('auto');
});

test('explainMismatch never names one of the two compared figures', () => {
  const r = printedFromWeek(w1106, { wage: WAGES_1106 });
  expect(explainMismatch(r, { reason: 'net_due_differs', details: [{ check: 'netDueMismatch', printed: 425.47, read: 850.94 }] })).toBeNull();
});

test('a whole-dollar line (the 100.00 bond) never explains a misread of exactly 100', () => {
  const r = printedFromWeek(w1106, { wage: WAGES_1106 });
  expect(explainMismatch(r, { reason: 'net_due_differs', details: [{ check: 'netDueMismatch', printed: 425.47, read: 525.47 }] })).toBeNull();
});
