// IMPORT GATE FIX 1.3 / 2.2 (owner 2026-11-03): a re-read reads only the
// pages that feed the failing check and keeps the others; a statement with
// no cash-flow section ends at TOTAL STATEMENT.
import { rereadKeptResults, statementBoundary, type PageResult, type PlanPage } from '../../../../supabase/functions/ai-import/jobEngine';
import { rereadRequestFor } from '@/src/import/settlementGate';
import type { Extraction } from '@/src/import/types';

const done = (page: number): PageResult => ({ status: 'done', role: 'content', kind: 'settlement', attempts: 1, run: 1, extraction: { page } });

describe('rereadKeptResults', () => {
  const plan: { pages: PlanPage[] } = {
    pages: [
      { page: 1, role: 'content', kind: 'settlement' },
      { page: 2, role: 'content', kind: 'settlement' },
      { page: 3, role: 'content', kind: 'statement' },
      { page: 4, role: 'stored', kind: 'other' },
    ],
  };
  const old = { '1': done(1), '2': { ...done(2), status: 'failed' as const }, '3': done(3), '4': done(4) };

  test('keeps finished content pages that are not re-read; never a failed or stored page', () => {
    expect(Object.keys(rereadKeptResults(plan, old, [3]))).toEqual(['1']);
  });
  test('a whole re-read (no page list) keeps nothing', () => {
    expect(rereadKeptResults(plan, old, null)).toEqual({});
    expect(rereadKeptResults(plan, old, [])).toEqual({});
  });
});

describe('statementBoundary without a cash-flow section', () => {
  test('ends at the page after TOTAL STATEMENT once it is classified without TOTAL CASH FLOW', () => {
    const pages = [
      { page: 4, kind: 'statement' as const, hasTotalCashFlow: false, hasStatementTotal: false },
      { page: 5, kind: 'statement' as const, hasTotalCashFlow: false, hasStatementTotal: true },
      { page: 6, kind: 'statement' as const, hasTotalCashFlow: false },
    ];
    expect(statementBoundary(pages, 6, 12)).toBe(6);
  });
  test('waits for the next window while TOTAL STATEMENT is on the window’s last page', () => {
    const pages = [{ page: 5, kind: 'statement' as const, hasTotalCashFlow: false, hasStatementTotal: true }];
    expect(statementBoundary(pages, 5, 12)).toBeNull();
  });
});

describe('rereadRequestFor', () => {
  const extraction = {
    docType: 'settlement',
    pageMap: [
      { page: 1, kind: 'settlement', role: 'content', status: 'read' },
      { page: 2, kind: 'statement', role: 'content', status: 'read' },
      { page: 3, kind: 'statement', role: 'content', status: 'read' },
      { page: 4, kind: 'other', role: 'stored', status: 'unread' },
    ],
  } as unknown as Extraction;

  test('a statement-only failure re-reads the statement pages, with the reason', () => {
    const req = rereadRequestFor({ status: 'fail', reason: 'statement_check_failed', failures: ['statementTotal'] } as never, extraction);
    expect(req).toEqual({ pages: [2, 3], reason: 'statement_check_failed: statementTotal' });
  });
  test('a gross mismatch re-reads both sides', () => {
    expect(rereadRequestFor({ status: 'fail', reason: 'gross_differs', failures: ['grossMatches'] } as never, extraction)!.pages).toEqual([1, 2, 3]);
  });
  test('no page map: the whole document, never a guess', () => {
    expect(rereadRequestFor({ status: 'fail', reason: 'statement_check_failed', failures: ['statementTotal'] } as never, { docType: 'settlement' } as Extraction)).toEqual({
      pages: null,
      reason: 'statement_check_failed: statementTotal',
    });
  });
  test('a passed gate asks for nothing', () => {
    expect(rereadRequestFor({ status: 'pass' } as never, extraction)).toBeNull();
  });
});
