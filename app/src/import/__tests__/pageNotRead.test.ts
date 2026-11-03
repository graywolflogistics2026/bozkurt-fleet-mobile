// A CONTENT PAGE THAT FAILED AFTER ITS RETRIES (owner decision 2026-11-03,
// the 10-page job's "p3 unreadable"): the job says which page and why,
// offers "Read page N again" for that page only, and never evaluates a
// statement check on a block that is missing a page.
import { withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { evaluateSettlementGate, rereadRequestFor } from '@/src/import/settlementGate';
import { decideJobVerdict, reviewOf } from '../../../../supabase/functions/ai-import/jobEngine';
import { failDetailLine, failedPagesToReadAgain, jobFailureInfo, jobFailureLines } from '@/src/import/jobFailure';
import type { Extraction } from '@/src/import/types';
import en from '@/src/i18n/locales/en.json';

const enT = (key: string, opts?: Record<string, unknown>) => {
  let v: unknown = en;
  for (const p of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[p];
  if (typeof v !== 'string') return String(opts?.defaultValue ?? key);
  return v.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};

const withPageMap = (e: Extraction, failed: { page: number; kind: string; detail: string }): Extraction => ({
  ...e,
  pagesTotal: 10,
  pageMap: Array.from({ length: 10 }, (_, i) => {
    const page = i + 1;
    if (page === failed.page) return { page, kind: failed.kind, role: 'content' as const, status: 'failed' as const, cause: 'unreadable', detail: failed.detail, attempts: 2 };
    return { page, kind: page <= 2 ? 'settlement' : page <= 6 ? 'statement' : 'other', role: page <= 6 ? ('content' as const) : ('stored' as const), status: page <= 6 ? ('read' as const) : ('unread' as const) };
  }),
});

describe('a content page that could not be read', () => {
  // The statement block lost its fuel lines with the page: variableCosts
  // would fail. It is never evaluated: the page is the reason.
  const missingLines = withStatement({ weekTotalVariableCosts: -3392.25, lines: [] as never });

  test('a statement page missing: page_not_read with the page and the exact cause, no statement check', () => {
    const gate = evaluateSettlementGate(withPageMap(missingLines, { page: 3, kind: 'statement', detail: 'parse_failed' }), { importDate: '2026-08-15' });
    expect(gate).toEqual({ status: 'fail', reason: 'page_not_read', failures: ['page_3'], details: [{ check: 'page', printed: 3, read: 'parse_failed' }] });
  });

  test('a settlement line page missing next to a passing statement still goes to Certify, line details differ', () => {
    const gate = evaluateSettlementGate(withPageMap(withStatement({}), { page: 2, kind: 'settlement', detail: 'timeout' }), { importDate: '2026-08-15' });
    expect(gate?.status).not.toBe('fail');
    if (gate && gate.status !== 'fail') expect(gate.lineDetails).toBe('mismatch');
  });

  test('the re-read asks for that page only', () => {
    const e = withPageMap(missingLines, { page: 3, kind: 'statement', detail: 'parse_failed' });
    const gate = evaluateSettlementGate(e, { importDate: '2026-08-15' });
    expect(rereadRequestFor(gate, e)).toEqual({ pages: [3], reason: 'page_not_read: page_3' });
  });

  test('the job verdict is final at once (the page already had its retries): page_failed, never an automatic re-read', () => {
    const d = decideJobVerdict(reviewOf(null), { readNo: 1, status: 'fail', reason: 'page_not_read', failures: ['page_3'], details: [{ check: 'page', printed: 3, read: 'parse_failed' }] }, { nowIso: '2026-11-03T10:00:00Z', rereadable: true });
    expect(d.action).toBe('final');
    expect(d.review.final).toMatchObject({ state: 'failed_final', reason: 'page_failed' });
    expect(d.review.reads).toBe(1);
  });

  test('the card and the jobs row say which page and why, and offer that page again', () => {
    expect(failDetailLine({ check: 'page', printed: 3, read: 'parse_failed' }, enT)).toBe("Page 3 could not be read: the AI's answer was not valid data, even after a second try");
    const job = {
      status: 'ready',
      review: { reads: 1, triggers: [], final: { state: 'failed_final', reason: 'page_failed', gateReason: 'page_not_read', details: [{ check: 'page', printed: 3, read: 'parse_failed' }] } },
      progress: { failed: [{ page: 3, kind: 'statement', type: 'unreadable', detail: 'parse_failed', run: 1, attempts: 2 }] },
      errorPage: null,
      errorStep: null,
    } as never;
    const info = jobFailureInfo(job);
    expect(jobFailureLines(info, enT)).toEqual([
      "Page 3 could not be read: the AI's answer was not valid data, even after a second try",
      'Reading the whole file again would fail the same way. Read only that page again.',
    ]);
    expect(failedPagesToReadAgain(info.details, info)).toEqual([3]);
    expect(enT('importFlow.readPagesAgain', { pages: '3' })).toBe('Read page 3 again');
  });
});
