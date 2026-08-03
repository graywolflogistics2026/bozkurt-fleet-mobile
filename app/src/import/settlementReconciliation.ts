import type { Extraction } from './types';

// SETTLEMENT RECONCILIATION HARD GUARD (owner decision 2026-08-03,
// device evidence: an 11-page settlement's continuation import correctly
// captured revenue/loads/escrow but showed Net Pay $0.00 and Deductions
// $0.00 while the AI's OWN summary text said "Total deductions from
// truck: $4,637.15" — i.e. gross income with zero recorded expenses.
// Saving that would be a real tax-accuracy bug (understating deductible
// expenses), not just an incomplete import — CLAUDE.md invariant #1's
// net-pay tax model depends on out-of-pocket/withheld deductions actually
// being captured. This is a pure, testable function; the import screen
// uses it to BLOCK Save entirely (no override) whenever it fails, rather
// than merely flagging for review — a half-settlement is worse than no
// settlement, since it looks complete and won't get a second look.
//
// Deliberately narrow: only the two concrete, high-confidence signals
// this bug actually produced, per the bug report's own framing ("prefer
// the AI's stated section totals as a cross-check EVERYWHERE"). A
// broader "does gross - deductions + reimbursements exactly equal net"
// formula is NOT checked here — that would false-positive on legitimate
// cases this app already handles (escrow held back, non-deduction
// chargebacks, negative settlements) that aren't reflected in a strict
// arithmetic identity.
export type ReconciliationIssue =
  | { type: 'deductionsMismatch'; stated: number; summed: number }
  | { type: 'zeroNetNonzeroGross'; grossRevenue: number };

export type ReconciliationResult = { ok: boolean; issues: ReconciliationIssue[] };

// Dollar tolerance for the deductions cross-check — allows for benign
// cent-level rounding in the AI's own arithmetic, never enough to mask a
// genuinely missing line item (a truly missing item is almost always
// tens or hundreds of dollars, not under a dollar).
const DEDUCTIONS_TOLERANCE = 1.0;

export function checkSettlementReconciliation(extraction: Extraction | null | undefined): ReconciliationResult {
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) {
    return { ok: true, issues: [] };
  }
  const s = extraction.settlement;
  const issues: ReconciliationIssue[] = [];

  const grossRevenue = Number(s.grossRevenue ?? 0);
  const statedTotalDeductions = Number(s.totalDeductions ?? 0);
  const summedDeductions = (s.deductions ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  // Only meaningful when the statement actually STATES a nonzero total —
  // a genuinely deduction-free settlement (rare, but possible) has
  // stated=0 AND summed=0, which correctly passes.
  if (statedTotalDeductions > 0 && Math.abs(statedTotalDeductions - summedDeductions) > DEDUCTIONS_TOLERANCE) {
    issues.push({ type: 'deductionsMismatch', stated: statedTotalDeductions, summed: summedDeductions });
  }

  // A real settlement's net pay is essentially never EXACTLY $0.00 while
  // gross revenue is genuinely nonzero (NEGATIVE SETTLEMENTS, CLAUDE.md,
  // already established net CAN legitimately be negative or very small —
  // but an exact zero alongside nonzero gross is the specific signature
  // of a missing/never-reached net-pay figure, not a real business
  // outcome).
  if (grossRevenue !== 0 && (s.netPay === 0 || s.netPay == null)) {
    issues.push({ type: 'zeroNetNonzeroGross', grossRevenue });
  }

  return { ok: issues.length === 0, issues };
}
