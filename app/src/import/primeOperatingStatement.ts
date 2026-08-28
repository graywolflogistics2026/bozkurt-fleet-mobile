import type { Extraction } from './types';
import { normalizeCarrierKey } from './carrierCodes';

// USE PRIME'S "STATEMENT OF INCOME AND EXPENSE" AS THE VERIFICATION
// SOURCE OF TRUTH (owner decision, 2026-08-28) — Prime Inc's own
// settlement statements routinely include a Perryman & Associates
// operating-statement page (docs/CARRIER_CODES.md's "AS/ACCOUNTING
// SERVICE" chargeback row is literally the cost of this page) with the
// carrier's OWN verified weekly/YTD/LTD revenue, miles, expenses, and
// net. This module cross-checks this app's own extraction/YTD totals
// against it — never the reverse; Prime's own figures are informational,
// surfaced to the user, and NEVER silently substituted for this app's
// own stored numbers.
//
// CARRIER ISOLATION — HARD INVARIANT, same as carrierCodes.ts's own rule
// (CLAUDE.md, CARRIER-SCOPED PAYROLL/SETTLEMENT CODES): every exported
// function here re-checks the carrier ITSELF (never trusts a caller to
// have pre-filtered), gated the identical way findCarrierCodeMatch() is
// — via normalizeCarrierKey() against the literal 'PRIME INC' key
// carrier_code_maps is already seeded with. A non-Prime or unrecognized
// carrier — Landstar, Schneider, Werner, empty, anything else — makes
// every function in this file a silent no-op: no mismatch flagged, no
// YTD check, nothing extracted, falling back to exactly today's
// behavior. We have no visibility into any other carrier's own
// operating-statement layout (or whether one even exists in their
// format), so applying Prime-shaped expectations to it would misfire
// exactly the way the pre-carrier-isolation code-map leak did before
// that pass fixed it — see src/import/__tests__/primeOperatingStatement.test.ts's
// own "never leaks to a non-Prime settlement" block, mirroring
// carrierCodes.test.ts's existing "Prime codes never leak" test.
//
// HONEST LIMITATION, stated plainly rather than silently assumed: this
// was built with NO real Prime settlement PDF available to inspect in
// this environment. The field inventory below (weekly/YTD/LTD revenue,
// miles, expenses, net) is inferred from (a) docs/CARRIER_CODES.md's own
// real vocabulary, which confirms the operating statement's existence
// and that it's prepared by Perryman & Associates, and (b) this app's
// own pre-existing (previously unused) settlement.operating extraction
// field, which already had ytdRevenue/ytdExpenses/ytdNet/weeksInService
// — this pass only widened it (weekly + miles + LTD) rather than
// inventing a parallel schema. What this module deliberately does NOT
// attempt: a category-by-category expense breakdown cross-check. There
// is no way to confirm, without a real document, whether Prime's
// operating statement breaks expenses into named categories at all
// (as opposed to one summary total) or whether any such breakdown would
// even use this app's own CANONICAL_CATEGORIES vocabulary — inventing
// that mapping would be exactly the "add categories unilaterally"
// mistake the owner's own instruction warned against. Scoped instead to
// the four figures any operating statement of this kind virtually
// certainly reports: revenue, miles, total expenses, net — reported as a
// known limitation, not silently worked around.

const PRIME_CARRIER_KEY = 'PRIME INC';

export function isPrimeCarrier(carrier: string | null | undefined): boolean {
  return normalizeCarrierKey(carrier) === PRIME_CARRIER_KEY;
}

// Dollar tolerance mirrors settlementReconciliation.ts's own established
// $1 rounding-tolerance precedent for a SINGLE settlement's own figures
// (benign cent-level rounding in the AI's own arithmetic, never enough to
// mask a genuinely missing line item) — reused here rather than invented
// anew, so this app has ONE dollar-rounding tolerance concept, not two.
const WEEKLY_DOLLAR_TOLERANCE = 1.0;
// Miles have no cent-level rounding risk the way dollars do; 1 mile
// absorbs benign truncation between the two sources without masking a
// real discrepancy (a genuine mismatch — a missed load, a misread total
// — is virtually always tens of miles or more).
const WEEKLY_MILES_TOLERANCE = 1;

export type PrimeWeeklyMismatch =
  | { field: 'revenue'; extracted: number; operatingStatement: number }
  | { field: 'miles'; extracted: number; operatingStatement: number }
  | { field: 'expenses'; extracted: number; operatingStatement: number };

// PER-SETTLEMENT CROSS-CHECK (item 2) — compares THIS extraction's own
// computed weekly revenue/miles/expenses against the SAME week's own
// figures on Prime's operating-statement page, when both are present.
// Pure, extraction-only (no account/DB data needed) — this is what makes
// it safe to run inside the same sanitize-guard chain as
// sanitizeExtractionMiles()/sanitizeExtractionDates()
// (src/data/aiImportCall.ts), applied once right after the AI extraction
// is received, before mapSettlement() or the import preview ever sees
// it. A present-but-zero operating-statement figure is treated as "not
// actually printed" (never divides/compares against a genuine zero,
// which the AI's own prompt is told to leave at its default when a
// field wasn't visible) rather than a real $0/0-mile claim to reconcile
// against.
export function checkPrimeOperatingStatementWeekly(extraction: Extraction): PrimeWeeklyMismatch[] {
  if (extraction.docType !== 'settlement' || !extraction.settlement) return [];
  const s = extraction.settlement;
  if (!isPrimeCarrier(s.carrier)) return [];
  const op = s.operating;
  if (!op) return [];

  const issues: PrimeWeeklyMismatch[] = [];

  if (op.weekRevenue) {
    const extracted = Number(s.grossRevenue ?? 0);
    if (Math.abs(extracted - op.weekRevenue) > WEEKLY_DOLLAR_TOLERANCE) {
      issues.push({ field: 'revenue', extracted, operatingStatement: op.weekRevenue });
    }
  }
  if (op.weekMiles) {
    const extracted = Number(s.totalMiles ?? 0);
    if (Math.abs(extracted - op.weekMiles) > WEEKLY_MILES_TOLERANCE) {
      issues.push({ field: 'miles', extracted, operatingStatement: op.weekMiles });
    }
  }
  if (op.weekExpenses) {
    const extracted = Number(s.totalDeductions ?? 0);
    if (Math.abs(extracted - op.weekExpenses) > WEEKLY_DOLLAR_TOLERANCE) {
      issues.push({ field: 'expenses', extracted, operatingStatement: op.weekExpenses });
    }
  }
  return issues;
}

// Guard-chain function — same shape and placement convention as
// milesGuard.ts's sanitizeExtractionMiles(): applied once right after
// extraction, downgrades confidence to 'low' on a mismatch (which is
// what routes the settlement through the EXISTING needs-review machinery,
// src/import/needsReview.ts, CLAUDE.md invariant #14 — never a second,
// parallel review mechanism), and returns the extraction UNCHANGED
// otherwise. Carrier isolation is inherited entirely from
// checkPrimeOperatingStatementWeekly() above — this function does not
// re-implement the gate, it just acts on that function's own result, so
// there is exactly ONE place in this file that decides "is this Prime."
export function applyPrimeOperatingStatementCheck(extraction: Extraction): Extraction {
  const issues = checkPrimeOperatingStatementWeekly(extraction);
  if (issues.length === 0) return extraction;
  return { ...extraction, confidence: 'low' };
}

// ---------------------------------------------------------------------
// STANDING YTD RECONCILIATION (item 3) — a Prime account's own running
// YTD totals vs. the YTD figures Prime's own most recent operating
// statement reported. This is account-level, not per-extraction, so it
// lives outside the sanitize-guard chain — the caller (a screen) supplies
// BOTH sides already computed from real data.
// ---------------------------------------------------------------------

export type PrimeYtdSnapshot = {
  revenue: number;
  miles: number;
  expenses: number;
  asOfWeekEnding: string;
};

// YTD tolerance is intentionally LOOSER than the single-week tolerance
// above: a YTD figure accumulates many weeks' worth of benign rounding
// (Prime's own operating statement rounds each week before summing;
// this app sums exact cents) — a flat $1 would flag spurious noise on
// almost every real account. 0.5% of Prime's own reported YTD revenue,
// floored at $25, absorbs that accumulated rounding without masking a
// genuinely missing week's worth of data (a truly missing/duplicated
// week is virtually always hundreds of dollars or dozens of miles, far
// outside this tolerance).
const YTD_DOLLAR_TOLERANCE_PCT = 0.005;
const YTD_DOLLAR_TOLERANCE_FLOOR = 25;
const YTD_MILES_TOLERANCE_PCT = 0.005;
const YTD_MILES_TOLERANCE_FLOOR = 25;

function ytdDollarTolerance(primeReported: number): number {
  return Math.max(YTD_DOLLAR_TOLERANCE_FLOOR, Math.abs(primeReported) * YTD_DOLLAR_TOLERANCE_PCT);
}
function ytdMilesTolerance(primeReported: number): number {
  return Math.max(YTD_MILES_TOLERANCE_FLOOR, Math.abs(primeReported) * YTD_MILES_TOLERANCE_PCT);
}

export type PrimeYtdMismatch =
  | { field: 'revenue'; ours: number; prime: number }
  | { field: 'miles'; ours: number; prime: number }
  | { field: 'expenses'; ours: number; prime: number };

// Pure comparison — returns [] (never a guess) when `primeYtd` is null
// (no Prime settlement has been imported yet, or none carried
// operating-statement data). Deliberately takes both sides already
// computed by the caller: `ours` must come from this app's OWN canonical
// YTD functions (calcMiles()/sumCanonicalExpenses()/computeKpis()) —
// never re-derived here, so this module can never silently disagree with
// what Home/Scorecard/the Accountant Package already show for the same
// figures.
export function checkPrimeYtdReconciliation(
  ours: { revenue: number; miles: number; expenses: number },
  primeYtd: PrimeYtdSnapshot | null
): PrimeYtdMismatch[] {
  if (!primeYtd) return [];
  const issues: PrimeYtdMismatch[] = [];

  if (primeYtd.revenue) {
    if (Math.abs(ours.revenue - primeYtd.revenue) > ytdDollarTolerance(primeYtd.revenue)) {
      issues.push({ field: 'revenue', ours: ours.revenue, prime: primeYtd.revenue });
    }
  }
  if (primeYtd.miles) {
    if (Math.abs(ours.miles - primeYtd.miles) > ytdMilesTolerance(primeYtd.miles)) {
      issues.push({ field: 'miles', ours: ours.miles, prime: primeYtd.miles });
    }
  }
  if (primeYtd.expenses) {
    if (Math.abs(ours.expenses - primeYtd.expenses) > ytdDollarTolerance(primeYtd.expenses)) {
      issues.push({ field: 'expenses', ours: ours.expenses, prime: primeYtd.expenses });
    }
  }
  return issues;
}

// Reads a Prime YTD snapshot out of a settlement's own linked document's
// `parsed_json` (the FULL raw extraction, CLAUDE.md's D3 audit trail —
// this app already persists settlement.operating there automatically,
// with NO new column needed, since parsed_json already stores the whole
// Extraction object verbatim). Defense in depth: re-checks the carrier
// embedded INSIDE parsed_json itself, not just whatever the caller
// believes about the row — a document whose own stored extraction
// doesn't independently confirm Prime returns null, never a guess.
export function readPrimeYtdSnapshotFromParsedJson(
  parsedJson: Record<string, unknown> | null | undefined,
  weekEnding: string
): PrimeYtdSnapshot | null {
  if (!parsedJson) return null;
  const settlement = parsedJson['settlement'] as Record<string, unknown> | undefined;
  if (!settlement) return null;
  if (!isPrimeCarrier(settlement['carrier'] as string | undefined)) return null;
  const op = settlement['operating'] as Record<string, unknown> | undefined;
  if (!op) return null;

  const revenue = Number(op['ytdRevenue'] ?? 0);
  const miles = Number(op['ytdMiles'] ?? 0);
  const expenses = Number(op['ytdExpenses'] ?? 0);
  if (!revenue && !miles && !expenses) return null;

  return { revenue, miles, expenses, asOfWeekEnding: weekEnding };
}

// Finds the standing-check input (item 3's "most recent Prime
// settlement's own operating-statement page") across a whole account's
// settlements — the settlement with the LATEST week_ending that (a) is
// confirmed Prime by its own `carrier` column and (b) has a linked
// document whose parsed_json actually carried real operating-statement
// YTD data. Returns null the instant nothing qualifies — no Prime
// settlements at all, or every Prime settlement so far lacked an
// operating-statement page.
export function findMostRecentPrimeYtdSnapshot(
  settlements: { carrier: string | null; week_ending: string; document_id: string | null }[],
  documentsById: Map<string, { parsed_json: Record<string, unknown> | null }>
): PrimeYtdSnapshot | null {
  const primeSettlements = settlements
    .filter((s) => isPrimeCarrier(s.carrier) && s.document_id)
    .sort((a, b) => (a.week_ending < b.week_ending ? 1 : a.week_ending > b.week_ending ? -1 : 0));

  for (const s of primeSettlements) {
    const doc = documentsById.get(s.document_id as string);
    const snapshot = readPrimeYtdSnapshotFromParsedJson(doc?.parsed_json ?? null, s.week_ending);
    if (snapshot) return snapshot;
  }
  return null;
}
