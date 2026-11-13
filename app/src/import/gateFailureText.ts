// A FAILURE SCREEN IS NEVER GENERIC (owner 2026-11-13, 07/17 device test).
// Every COULD NOT READ line set names what is wrong: the printed label that
// was not read and the pages it was looked for on, or the failing check
// with its printed and read values, or the date problem. Shared by the
// reader's job view (readerJob.ts), the import screen's card and the Send
// report. Pure; the caller passes t().
import { formatPageList } from './importJobs';
import type { Extraction } from './types';

type T = (key: string, opts?: Record<string, unknown>) => string;
export type FailDetailLike = { check: string; printed: number | string; read: number | string };

// The printed label behind each "not read" code of the gate (settlementGate
// failures for statement_not_read / missing_fields / totals_not_printed).
// Labels are printed document text: they stay as printed in every language.
export const MISSING_LABEL: Record<string, string> = {
  totalRevenue: 'TOTAL REVENUE',
  totalOperatingExpenses: 'TOTAL OPERATING EXPENSES',
  totalStatement: 'TOTAL STATEMENT OF INCOME & EXPENSE',
  settlementToOperator: 'SETTLEMENT TO OPERATOR',
  variableCosts: 'TOTAL VARIABLE COSTS',
  fixedCost: 'TOTAL FIXED COST',
  statementWeekEnding: 'WEEK ENDING (statement header)',
  statementWeek: 'TOTAL REVENUE / TOTAL STATEMENT OF INCOME & EXPENSE',
  grossRevenue: 'TOTAL REV',
  netDue: 'NET AMOUNT DUE UNIT',
  totalDeductions: 'TOTAL DEDUCTIONS FROM TRUCK',
};

export const DATE_ISSUES = ['unreadable', 'older_reading', 'print_gap', 'not_friday', 'statement_week_differs', 'pdf_created_far', 'future', 'too_old', 'ambiguous', 'pages_differ'];

// "4–5": the pages the statement rows were read from (none read: null).
export function printedStatementPages(extraction: Extraction | null | undefined): string | null {
  const op = extraction?.settlement?.operating;
  const pages = [...(op?.lines ?? []), ...(op?.recapLines ?? [])].map((l) => (l as { page?: unknown }).page).filter((p): p is number => typeof p === 'number' && Number.isInteger(p));
  return pages.length > 0 ? formatPageList(pages) : null;
}

// The lines under the reason: every failing check (printed vs read), every
// label not read (with its pages), every date problem. Never empty.
export function gateFailureLines(
  failure: { reason: string; failures?: string[]; details?: FailDetailLike[] },
  t: T,
  value: (v: number | string) => string = (v) => String(v),
  pages: string | null = null
): string[] {
  const lines: string[] = [];
  const checks = new Set<string>();
  for (const d of failure.details ?? []) {
    checks.add(d.check);
    if (d.check === 'page') lines.push(t('importFlow.pageFailed', { page: d.printed, cause: t(`importFlow.pageCause.${d.read}`, { defaultValue: String(d.read) }) }));
    else lines.push(t('importFlow.failDetail', { check: t(`importFlow.checkName.${d.check}`, { defaultValue: d.check }), printed: value(d.printed), read: value(d.read) }));
  }
  for (const code of failure.failures ?? []) {
    if (checks.has(code) || code === failure.reason) continue;
    if (MISSING_LABEL[code]) {
      lines.push(pages ? t('importFlow.notReadOnPages', { label: MISSING_LABEL[code], pages }) : t('importFlow.notRead', { label: MISSING_LABEL[code] }));
    } else if (DATE_ISSUES.includes(code)) {
      lines.push(t(`importFlow.dateIssue.${code}`, { defaultValue: code }));
    } else {
      lines.push(t('importFlow.failedCheck', { check: t(`importFlow.checkName.${code}`, { defaultValue: code }) }));
    }
  }
  if (lines.length === 0) lines.push(t('importFlow.serverAnswerMissing', { field: `failures (${failure.reason})` }));
  return lines;
}
