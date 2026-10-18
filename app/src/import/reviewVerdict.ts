import type { Extraction } from './types';
import { checkSettlementReconciliation, type ReconciliationIssue } from './settlementReconciliation';
import {
  buildPrimeStatementCheck,
  buildSettlementStatement,
  printedTotalsMatch,
  printedTotalsOf,
  statementPagesOf,
  type PrimeStatementCheckResult,
  type StatementCheck,
} from './settlementStatement';
import { buildPrimeGroupChecks, type PrimeGroupCheck } from './primeLineGroups';
import { splitPrimeLoads } from './primeLoads';
import { isPrimeCarrier } from './primeOperatingStatement';
import { applyCarrierCodeCategories, normalizeCarrierKey, type CarrierCode } from './carrierCodes';
import { mapSettlement } from './mapExtraction';
import { statementWeekOf } from '@/src/stats/statementRoute';
import { calcTrueProfit } from '@/src/stats/trueProfit';

// SIMPLE REVIEW SCREEN (owner decision 2026-10-17, item 7): one plain
// verdict, one reason, one action, for a settlement on the import preview.
//   green  verified      "Verified by Prime's statement. Profit $X, deposited $Y"   [Save]
//   green  totals_match  "Totals match. Profit estimated from line items. $X"         [Save]
//   amber  needs_look    "Saved from the statement; line details need a look"       [Save][Details]
//   red    not_verified  "We couldn't verify this week" + one sentence              [Read again][Save as estimate][Discard]
// Everything else lives under Details. The gate (item 6) decides green /
// amber vs red for a Prime week with a statement; without a statement,
// today's blocking guard decides (`saveBlocked`).

export type VerdictReason =
  | { kind: 'line_details_differ'; amount: number }
  | { kind: 'statement_warning'; check: StatementCheck }
  | { kind: 'loads_revenue_mismatch' }
  | { kind: 'pages_incomplete'; pages: number[] }
  | { kind: 'statement_check_failed'; check: StatementCheck }
  | { kind: 'statement_not_read'; missing: string[] }
  | { kind: 'line_check_failed'; issue: ReconciliationIssue }
  | { kind: 'totals_not_printed' };

export type ReviewVerdict =
  | { tone: 'green'; kind: 'verified'; profit: number; deposit: number }
  | { tone: 'green'; kind: 'totals_match'; profit: number }
  | { tone: 'amber'; kind: 'needs_look'; profit: number; deposit: number; reason: VerdictReason }
  | { tone: 'red'; kind: 'not_verified'; reason: VerdictReason };

export type ReviewInputs = {
  check: PrimeStatementCheckResult | null;
  issues: ReconciliationIssue[];
  groups: PrimeGroupCheck[] | null;
};

export function reviewInputsOf(extraction: Extraction): ReviewInputs {
  return {
    check: buildPrimeStatementCheck(extraction),
    issues: checkSettlementReconciliation(extraction).issues,
    groups: buildPrimeGroupChecks(extraction),
  };
}

// The difference of one line-item total from what the statement printed.
function issueDifference(issue: ReconciliationIssue): number | null {
  switch (issue.type) {
    case 'deductionsMismatch':
    case 'revenueLinesMismatch':
    case 'reimbursementLinesMismatch':
      return issue.summed - issue.stated;
    case 'netDueMismatch':
    case 'depositMismatch':
      return issue.computed - issue.stated;
    default:
      return null;
  }
}

// How far the line details are from the statement: the largest line-item
// total or per-group difference. Null when everything ties (within $1).
export function lineDetailsDifference(inputs: Pick<ReviewInputs, 'issues' | 'groups'>): number | null {
  const diffs = [
    ...inputs.issues.map(issueDifference).filter((d): d is number => d != null),
    ...(inputs.groups ?? []).filter((g) => !g.passed).map((g) => g.difference),
  ];
  if (diffs.length === 0) return null;
  const largest = diffs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  return Math.round(largest * 100) / 100;
}

// A stored reading from a prompt older than 2026-10-17: no printed labels
// of the header totals, or a Prime statement read without the balance
// forward field. "Read again" is offered first.
export function isOlderReading(extraction: Extraction | null | undefined): boolean {
  const s = extraction?.settlement;
  if (!s || extraction?.docType !== 'settlement') return false;
  if (s.totalLabels === undefined) return true;
  const op = s.operating;
  return isPrimeCarrier(s.carrier) && (op?.lines?.length ?? 0) > 0 && op?.priorWeekBalanceForward === undefined;
}

const PREVIEW_ID = 'preview';

// Profit from the settlement's own line items (the line route), as the
// profit engine would count it after save, with the carrier's code map
// applied the same way.
export function lineRouteProfit(extraction: Extraction, carrierCodes: CarrierCode[] = []): number {
  const mapping = mapSettlement(extraction, PREVIEW_ID, null);
  const deductions = applyCarrierCodeCategories(mapping.deductions, normalizeCarrierKey(extraction.settlement?.carrier), carrierCodes);
  const link = <R extends object>(rows: R[]) => rows.map((r) => ({ ...r, settlement_id: PREVIEW_ID }));
  return calcTrueProfit(
    [{ id: PREVIEW_ID, gross: mapping.settlement.gross ?? 0, week_ending: mapping.settlement.week_ending, truck_id: null, statement: null }],
    link(deductions).map((d) => ({ ...d, tax_deductible: d.tax_deductible ?? null })),
    link(mapping.fuel).map((f) => ({ ...f, amount: f.amount ?? null })),
    link(mapping.maintenance).map((m) => ({ ...m, cost: m.cost ?? null })),
    link(mapping.tolls).map((t) => ({ ...t, amount: t.amount ?? null })),
    link(mapping.reimbursements).map((r) => ({ ...r, amount: r.amount ?? null }))
  );
}

export function buildReviewVerdict(
  extraction: Extraction | null | undefined,
  options: { carrierCodes?: CarrierCode[]; saveBlocked: boolean }
): ReviewVerdict | null {
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) return null;
  const inputs = reviewInputsOf(extraction);
  const { check, issues } = inputs;

  if (check?.gatePassed) {
    const statement = buildSettlementStatement(extraction, { savedFlagged: false, priorLabelsSeen: new Set() });
    const week = statementWeekOf({ id: PREVIEW_ID, statement })!;
    const profit = Math.round((week.gross - week.expenses) * 100) / 100;
    const deposit = week.deposit;
    const difference = lineDetailsDifference(inputs);
    const pages = statementPagesOf(extraction);
    const loads = splitPrimeLoads(extraction);
    const reason: VerdictReason | null =
      difference != null
        ? { kind: 'line_details_differ', amount: Math.abs(difference) }
        : (check.warnings?.length ?? 0) > 0
          ? { kind: 'statement_warning', check: check.warnings![0] }
          : loads && loads.loads.length > 0 && loads.matches !== true
            ? { kind: 'loads_revenue_mismatch' }
            : pages && pages.incomplete.length > 0
              ? { kind: 'pages_incomplete', pages: pages.incomplete.map((p) => p.page) }
              : null;
    return reason ? { tone: 'amber', kind: 'needs_look', profit, deposit, reason } : { tone: 'green', kind: 'verified', profit, deposit };
  }

  if (check) {
    const failed = check.checks.find((c) => !c.passed && c.id !== 'milesMatch' && c.id !== 'grossMatches');
    if (failed) return { tone: 'red', kind: 'not_verified', reason: { kind: 'statement_check_failed', check: failed } };
    return { tone: 'red', kind: 'not_verified', reason: { kind: 'statement_not_read', missing: check.gateMissing ?? [] } };
  }

  // No statement page: today's blocking guard.
  if (options.saveBlocked && issues.length > 0) return { tone: 'red', kind: 'not_verified', reason: { kind: 'line_check_failed', issue: issues[0] } };
  if (issues.length === 0 && printedTotalsMatch(printedTotalsOf(extraction))) {
    return { tone: 'green', kind: 'totals_match', profit: Math.round(lineRouteProfit(extraction, options.carrierCodes) * 100) / 100 };
  }
  if (issues.length > 0) return { tone: 'red', kind: 'not_verified', reason: { kind: 'line_check_failed', issue: issues[0] } };
  return { tone: 'red', kind: 'not_verified', reason: { kind: 'totals_not_printed' } };
}

// Whether Save is blocked — the gate when a Prime statement passed it,
// else today's guard (owner decision 2026-10-17, item 6).
export function isSaveBlocked(extraction: Extraction | null | undefined): boolean {
  if (!extraction) return false;
  const check = buildPrimeStatementCheck(extraction);
  if (check?.gatePassed) return false;
  return !checkSettlementReconciliation(extraction).ok || (!!check && !check.passed);
}

// The extraction Save writes when the gate passed but something only
// warns: needs-review (confidence low) and the warnings kept in
// parsed_json for the audit trail — never `reconciliationOverride`, which
// would put the week on the line route.
export function markReviewWarnings(extraction: Extraction): Extraction {
  const inputs = reviewInputsOf(extraction);
  const warnings = [...inputs.issues, ...(inputs.check?.warnings ?? []), ...(inputs.groups ?? []).filter((g) => !g.passed)];
  if (warnings.length === 0) return extraction;
  return { ...extraction, confidence: 'low', reviewWarnings: warnings };
}
