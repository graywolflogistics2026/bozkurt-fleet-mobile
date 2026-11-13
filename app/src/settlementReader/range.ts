// CONTENT RANGE (owner decision 2026-11-13, P1). Page 1 to the page that
// prints TOTAL CASH FLOW; when no cash-flow section is printed, to the page
// that prints TOTAL STATEMENT OF INCOME & EXPENSE (07/17, 07/24). Every page
// after it is an attachment (P5). A settlement with neither (another
// carrier, no statement) ends at its last settlement/accounts/recap page.

import type { RangeReply } from './schema';

// Pages shown to the range call: Prime's content is on pages 1-6 of files
// of 8-21 pages (owner's 13 weeks); 10 leaves room for another layout.
export const RANGE_WINDOW_PAGES = 10;
export const MAX_ATTACHMENT_PAGES = 12;

export type ContentRange = {
  carrier: string;
  isSettlement: boolean;
  lastContentPage: number;
  // First page of the Statement of Income and Expense (the fallback split
  // reads 1..statementFirst-1 and statementFirst..last); null = none.
  statementFirst: number | null;
  cashFlowPrinted: boolean;
  attachmentPages: number[];
  attachmentsNotRead: number;
};

export type RangeResult = { ok: true; range: ContentRange } | { ok: false; reason: 'range_not_found' };

export function contentRange(reply: RangeReply, totalPages: number): RangeResult {
  const window = Math.min(totalPages, RANGE_WINDOW_PAGES);
  const pages = (reply.pages ?? []).filter((p) => Number.isInteger(p.page) && p.page >= 1 && p.page <= window);
  const max = (list: number[]) => (list.length > 0 ? Math.max(...list) : null);
  const cashFlow = max(pages.filter((p) => p.hasTotalCashFlow).map((p) => p.page));
  const statementTotal = max(pages.filter((p) => p.hasTotalStatement).map((p) => p.page));
  const contentKinds = new Set(['settlement', 'accounts', 'recap', 'statement']);
  const lastContentKind = max(pages.filter((p) => contentKinds.has(p.kind)).map((p) => p.page));
  if (!reply.isSettlement) {
    // Not a settlement: the whole window is content for the general reader.
    return { ok: true, range: rangeOf(reply, totalPages, window, null, false) };
  }
  const last = cashFlow ?? statementTotal ?? lastContentKind;
  if (last == null) return { ok: false, reason: 'range_not_found' };
  const statementPages = pages.filter((p) => p.kind === 'statement' && p.page <= last).map((p) => p.page);
  const statementFirst = statementPages.length > 0 ? Math.min(...statementPages) : null;
  return { ok: true, range: rangeOf(reply, totalPages, last, statementFirst != null && statementFirst > 1 ? statementFirst : null, cashFlow != null) };
}

function rangeOf(reply: RangeReply, totalPages: number, last: number, statementFirst: number | null, cashFlowPrinted: boolean): ContentRange {
  const after: number[] = [];
  for (let p = last + 1; p <= totalPages; p++) after.push(p);
  return {
    carrier: (reply.carrier ?? '').trim(),
    isSettlement: !!reply.isSettlement,
    lastContentPage: last,
    statementFirst,
    cashFlowPrinted,
    attachmentPages: reply.isSettlement ? after.slice(0, MAX_ATTACHMENT_PAGES) : [],
    attachmentsNotRead: reply.isSettlement ? Math.max(0, after.length - MAX_ATTACHMENT_PAGES) : 0,
  };
}

export function pagesUpTo(last: number, from = 1): number[] {
  const out: number[] = [];
  for (let p = from; p <= last; p++) out.push(p);
  return out;
}
