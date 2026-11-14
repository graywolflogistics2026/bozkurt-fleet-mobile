// IMPORT GATE FIX 1.3 (owner 2026-11-03): a re-read reads only the pages
// that feed the failing check (the shared gate's rereadRequestFor). The
// old job engine's re-read plan tests went with the old reader (2026-11-13).
import { rereadRequestFor } from '@/src/import/settlementGate';
import type { Extraction } from '@/src/import/types';

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
