import type { Extraction } from './types';
import { checkSettlementReconciliation } from './settlementReconciliation';
import {
  buildPrimeStatementCheck,
  buildSettlementStatement,
  printedTotalsMatch,
  printedTotalsOf,
  settlementDeposit,
  statementPagesOf,
} from './settlementStatement';
import { buildPrimeGroupChecks } from './primeLineGroups';
import { splitPrimeLoads } from './primeLoads';
import { isPrimeCarrier } from './primeOperatingStatement';
import { checkSettlementDates, isDateGateSatisfied, settlementDateInputsOf, type DateIssue, type SettlementDateCheck } from './printedDates';
import { lineDetailsDifference, lineRouteProfit } from './reviewVerdict';
import { readMilesSplit } from './milesSplit';
import type { CarrierCode } from './carrierCodes';
import { statementWeekOf } from '@/src/stats/statementRoute';
import { defaultPerDiemDaysForMiles } from '@/src/tax/perDiem';
import { num } from '@/src/lib/number';

// ONE PASS/FAIL GATE (owner decision 2026-10-31, batch D2 part 2.2). The
// import card AND saveExtraction() both call evaluateSettlementGate(); there
// is no override and no "Save anyway". Three outcomes:
//   pass       -> the CHECK AND CERTIFY card (headline numbers below);
//   fail       -> "We couldn't read this statement reliably. Nothing was
//                 saved." (after up to 2 automatic re-reads);
//   needs_date -> the card asks the one date question (Yes / pick a date).
// Prime: the statement gate (every check inside the statement, the cash
// chain with balance forward, statement week ending = settlement date),
// TOTAL REVENUE = the gross read on page 1, net due identity, deposit chain
// and the date gate. A date that disagrees with another printed date fails
// (a misread); a date that is only unusual (not a Friday, older than 14
// months, in the future) is asked, as built. When the statement passes but
// the LINE DETAILS do not reconcile, the week passes with
// lineDetails 'mismatch': it is saved from the statement and the
// mismatching line rows are not stored.
// Other carriers (and a Prime read with no statement page): printed totals identity within $1, required fields
// (week ending, gross, net due), the line items adding up to the printed
// totals (profit comes from those lines); no printed totals -> fail.

export type GateFailReason =
  | 'statement_not_read'
  | 'statement_check_failed'
  | 'gross_differs'
  | 'net_due_differs'
  | 'deposit_differs'
  | 'date_mismatch'
  | 'date_unreadable'
  | 'missing_fields'
  | 'totals_not_printed'
  | 'totals_differ'
  | 'lines_differ';

export type GateHeadline = {
  weekEnding: string | null;
  carrier: string | null;
  revenue: number;
  netDue: number | null;
  // The printed deposit (Prime: SETTLEMENT TO OPERATOR) — 0 when the week
  // is owed to the carrier (owedToCarrier > 0).
  deposited: number;
  owedToCarrier: number;
  miles: number | null;
  loadedMiles: number | null;
  emptyMiles: number | null;
  perDiemDays: number;
  // Labeled "estimate" wherever it is shown.
  estimatedProfit: number;
  source: 'prime_statement' | 'printed_totals';
};

export type SettlementGateResult =
  | { status: 'pass'; headline: GateHeadline; lineDetails: 'match' | 'mismatch'; lineDifference: number | null }
  | { status: 'fail'; reason: GateFailReason; failures: string[] }
  | { status: 'needs_date'; headline: GateHeadline; lineDetails: 'match' | 'mismatch'; lineDifference: number | null; dateCheck: SettlementDateCheck };

const PREVIEW_ID = 'gate-preview';
const r2 = (n: number) => Math.round(n * 100) / 100;

// Prime date issues that mean two printed dates disagree (a misread):
// re-read, then fail. Everything else is only unusual and is asked.
const PRIME_MISREAD_DATE_ISSUES: DateIssue[] = ['unreadable', 'print_gap', 'statement_week_differs', 'pdf_created_far'];

function fail(reason: GateFailReason, failures: string[] = []): SettlementGateResult {
  return { status: 'fail', reason, failures: failures.length > 0 ? failures : [reason] };
}

function milesOf(extraction: Extraction, statementMiles: number | null) {
  const s = extraction.settlement!;
  const split = readMilesSplit({ carrier: s.carrier, loads: s.loads, milesLines: s.milesLines });
  const read = statementMiles != null && statementMiles > 0 ? statementMiles : num(s.totalMiles) > 0 ? num(s.totalMiles) : (split.total ?? null);
  const perDiem = Number.isFinite(s.perDiemDays as number) ? Math.max(0, Math.min(7, Math.round(s.perDiemDays as number))) : defaultPerDiemDaysForMiles(read ?? 0);
  return { miles: read, loadedMiles: split.loaded, emptyMiles: split.empty, perDiemDays: perDiem };
}

export function evaluateSettlementGate(
  extraction: Extraction | null | undefined,
  options: { importDate: string; carrierCodes?: CarrierCode[] }
): SettlementGateResult | null {
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) return null;
  const s = extraction.settlement;
  const prime = isPrimeCarrier(s.carrier);
  const issues = checkSettlementReconciliation(extraction).issues;
  const issueTypes = issues.map((i) => i.type);
  const dateCheck = checkSettlementDates(settlementDateInputsOf(extraction), options.importDate);
  const weekEnding = s.weekEnding || dateCheck.weekEnding || null;
  const dateOk = isDateGateSatisfied(dateCheck, weekEnding, s.dateConfirmed);

  const check = prime ? buildPrimeStatementCheck(extraction) : null;
  // A Prime read without the Statement of Income and Expense (a photo of
  // the settlement page only) is checked like any other carrier: printed
  // totals + line items — but only when no content page went unread
  // (a statement page that failed to read is a re-read, then a fail).
  const pagesRead = statementPagesOf(extraction);
  if (prime && !check && pagesRead != null && pagesRead.incomplete.length > 0) return fail('statement_not_read');
  if (check) {
    if (!check.gatePassed) {
      const failed = check.checks.filter((c) => !c.passed && c.id !== 'milesMatch' && c.id !== 'grossMatches').map((c) => c.id);
      if (failed.includes('statementWeekEnding')) return fail('date_mismatch', failed);
      return failed.length > 0 ? fail('statement_check_failed', failed) : fail('statement_not_read', (check.gateMissing ?? []).map(String));
    }
    if (check.checks.some((c) => c.id === 'grossMatches' && !c.passed)) return fail('gross_differs', ['grossMatches']);
    if (issueTypes.includes('netDueMismatch')) return fail('net_due_differs', ['netDueMismatch']);
    if (issueTypes.includes('depositMismatch')) return fail('deposit_differs', ['depositMismatch']);
    if (issueTypes.includes('zeroNetNonzeroGross')) return fail('missing_fields', ['netDue']);
    if (!dateOk && dateCheck.issues.some((i) => PRIME_MISREAD_DATE_ISSUES.includes(i))) {
      return fail(dateCheck.issues.includes('unreadable') ? 'date_unreadable' : 'date_mismatch', dateCheck.issues);
    }

    const statement = buildSettlementStatement(extraction, { savedFlagged: false, priorLabelsSeen: new Set() });
    const week = statementWeekOf({ id: PREVIEW_ID, statement });
    if (!week) return fail('statement_not_read');
    const deposit = settlementDeposit({ statement });
    const groups = buildPrimeGroupChecks(extraction);
    const difference = lineDetailsDifference({ issues, groups });
    const loads = splitPrimeLoads(extraction);
    const pages = statementPagesOf(extraction);
    const mismatch =
      difference != null || (loads != null && loads.loads.length > 0 && loads.matches === false) || (pages != null && pages.incomplete.length > 0);
    const headline: GateHeadline = {
      weekEnding,
      carrier: s.carrier ?? null,
      revenue: r2(week.gross),
      netDue: statement.printed.netDue,
      deposited: r2(deposit.deposited),
      owedToCarrier: r2(deposit.owedToCarrier),
      ...milesOf(extraction, check.totals.miles ?? null),
      estimatedProfit: r2(week.gross - week.expenses),
      source: 'prime_statement',
    };
    const lineDetails = mismatch ? 'mismatch' : 'match';
    if (!dateOk) return { status: 'needs_date', headline, lineDetails, lineDifference: difference, dateCheck };
    return { status: 'pass', headline, lineDetails, lineDifference: difference };
  }

  // Other carriers.
  const printed = printedTotalsOf(extraction);
  if (printed.grossRevenue == null && printed.totalDeductions == null && printed.netDue == null) return fail('totals_not_printed');
  if (printed.grossRevenue == null || printed.netDue == null || issueTypes.includes('zeroNetNonzeroGross')) return fail('missing_fields');
  if (printed.totalDeductions == null) return fail('totals_not_printed');
  if (!printedTotalsMatch(printed) || issueTypes.includes('netDueMismatch')) return fail('totals_differ', issueTypes);
  if (issueTypes.includes('depositMismatch')) return fail('deposit_differs', ['depositMismatch']);
  const lineIssues = issueTypes.filter((t) => t === 'deductionsMismatch' || t === 'revenueLinesMismatch' || t === 'reimbursementLinesMismatch');
  if (lineIssues.length > 0) return fail('lines_differ', lineIssues);
  if (dateCheck.issues.includes('unreadable') && !dateOk) return fail('date_unreadable', dateCheck.issues);

  const deposit = settlementDeposit({ statement: { printed } as never });
  const headline: GateHeadline = {
    weekEnding,
    carrier: s.carrier ?? null,
    revenue: printed.grossRevenue,
    netDue: printed.netDue,
    deposited: r2(deposit.deposited),
    owedToCarrier: r2(deposit.owedToCarrier),
    ...milesOf(extraction, null),
    estimatedProfit: r2(lineRouteProfit(extraction, options.carrierCodes ?? [])),
    source: 'printed_totals',
  };
  if (!dateOk) return { status: 'needs_date', headline, lineDetails: 'match', lineDifference: null, dateCheck };
  return { status: 'pass', headline, lineDetails: 'match', lineDifference: null };
}

// The plain one-sentence reason shown on the COULD NOT READ card.
export const GATE_FAIL_REASON_KEY: Record<GateFailReason, string> = {
  statement_not_read: 'importFlow.reason.statementNotRead',
  statement_check_failed: 'importFlow.reason.statementCheckFailed',
  gross_differs: 'importFlow.reason.grossDiffers',
  net_due_differs: 'importFlow.reason.netDueDiffers',
  deposit_differs: 'importFlow.reason.depositDiffers',
  date_mismatch: 'importFlow.reason.dateMismatch',
  date_unreadable: 'importFlow.reason.dateUnreadable',
  missing_fields: 'importFlow.reason.missingFields',
  totals_not_printed: 'importFlow.reason.totalsNotPrinted',
  totals_differ: 'importFlow.reason.totalsDiffer',
  lines_differ: 'importFlow.reason.linesDiffer',
};

// Automatic re-reads before COULD NOT READ is shown (spec 2.1).
export const MAX_AUTO_REREADS = 2;

// What the import screen does with a reading (spec 2.1/2.2):
//   pass + lines match  -> the CHECK AND CERTIFY card;
//   needs_date          -> the card, with the one date question;
//   fail                -> re-read automatically (up to 2 times), then
//                          COULD NOT READ;
//   pass + line details differ -> re-read the line pages (up to 2 times),
//                          then the card (saved without the line rows).
export type ImportStep = 'certify' | 'reread' | 'could_not_read';

export function nextImportStep(gate: SettlementGateResult | null, rereadsDone: number): ImportStep {
  if (!gate) return 'certify';
  const canReread = rereadsDone < MAX_AUTO_REREADS;
  if (gate.status === 'fail') return canReread ? 'reread' : 'could_not_read';
  if (gate.lineDetails === 'mismatch' && canReread) return 'reread';
  return 'certify';
}

// A re-read can come back worse than the reading before it. The best one
// so far is kept: pass with matching lines > pass with differing lines >
// needs a date answer > fail.
export function gateRank(gate: SettlementGateResult | null): number {
  if (!gate) return 0;
  if (gate.status === 'fail') return 0;
  const lines = gate.lineDetails === 'match' ? 1 : 0;
  return gate.status === 'pass' ? 3 + lines : 1 + lines;
}

export function pickBetterReading<T>(previous: { reading: T; gate: SettlementGateResult | null } | null | undefined, next: { reading: T; gate: SettlementGateResult | null }) {
  if (!previous) return next;
  return gateRank(next.gate) >= gateRank(previous.gate) ? next : previous;
}

// The gate result kept in documents.parsed_json for audit and routing
// (spec 2.3: "keep the gate result in the data"). Never shown as a label.
export function withGateAudit(extraction: Extraction, gate: SettlementGateResult): Extraction {
  const audit =
    gate.status === 'fail'
      ? { status: gate.status, reason: gate.reason, failures: gate.failures }
      : { status: gate.status, lineDetails: gate.lineDetails, lineDifference: gate.lineDifference };
  return { ...extraction, settlementGate: audit };
}

// "Not certified [Certify]" on a week saved before batch D2: the same
// headline card, built from the stored numbers (never re-read).
export function headlineFromSettlement(
  s: {
    week_ending: string;
    carrier: string | null;
    gross: number;
    net: number;
    miles: number | null;
    loaded_miles?: number | null;
    empty_miles?: number | null;
    per_diem_days?: number | null;
    statement?: import('./settlementStatement').SettlementStatement | null;
  },
  estimatedProfit: number
): GateHeadline {
  const deposit = settlementDeposit({ net: s.net, statement: s.statement ?? null });
  return {
    weekEnding: s.week_ending,
    carrier: s.carrier,
    revenue: r2(Number(s.gross ?? 0)),
    netDue: s.statement?.printed?.netDue ?? Number(s.net ?? 0),
    deposited: r2(deposit.deposited),
    owedToCarrier: r2(deposit.owedToCarrier),
    miles: s.miles != null && Number(s.miles) > 0 ? Number(s.miles) : null,
    loadedMiles: s.loaded_miles ?? null,
    emptyMiles: s.empty_miles ?? null,
    perDiemDays: Number(s.per_diem_days ?? 0),
    estimatedProfit: r2(estimatedProfit),
    source: s.statement?.source ?? 'printed_totals',
  };
}

// The two quiet lines on settlement detail (batch D2 2.2/2.4), from the
// stored statement and the week's document (parsed_json.pageMap):
//   "Line details were not saved because they did not match your
//    statement. [Try reading them again]"  -> the content pages;
//   "Attachments: N saved, M read [Read]"  -> up to 12 unread pages.
export const ATTACHMENT_READ_CAP = 12;

export function weekQuietLines(
  statement: { linesNotSaved?: boolean } | null | undefined,
  parsedJson: Record<string, unknown> | null | undefined
): { linesNotSaved: boolean; contentPages: number[]; attachments: { saved: number; read: number; unreadPages: number[] } | null } {
  const map = Array.isArray(parsedJson?.pageMap) ? (parsedJson!.pageMap as { page: number; role: string; status: string }[]) : [];
  const contentPages = map.filter((p) => p.role === 'content').map((p) => p.page);
  const attachmentPages = map.filter((p) => p.role === 'attachment' || p.role === 'stored');
  const read = attachmentPages.filter((p) => p.role === 'attachment' && p.status === 'read');
  const unreadPages = attachmentPages.filter((p) => !(p.role === 'attachment' && p.status === 'read')).map((p) => p.page).slice(0, ATTACHMENT_READ_CAP);
  return {
    linesNotSaved: !!statement?.linesNotSaved,
    contentPages,
    attachments: attachmentPages.length > 0 ? { saved: attachmentPages.length, read: read.length, unreadPages } : null,
  };
}
