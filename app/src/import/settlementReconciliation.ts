import type { Extraction } from './types';
import { parseAmount, printedTotal, sumAmounts } from './amount';
import { resolveFuelRows } from '@/src/stats/trueProfit';
import { printedDepositOf, printedInterestIncomeOf } from './settlementStatement';

// SETTLEMENT RECONCILIATION HARD GUARD (owner decision 2026-08-03,
// device evidence: an 11-page settlement's continuation import correctly
// captured revenue/loads/escrow but showed Net Pay $0.00 and Deductions
// $0.00 while the AI's OWN summary text said "Total deductions from
// truck: $4,637.15" — i.e. gross income with zero recorded expenses).
// The import screen BLOCKS Save whenever this fails; a half-settlement
// looks complete and won't get a second look.
//
// GOLDEN SETTLEMENT PASS (owner decision 2026-10-13, every carrier) —
// widened from one total to every total a statement prints, so a dropped
// page line, a lost minus sign or the wrong revenue column is caught at
// import instead of reaching profit:
//   - deduction lines (plus fuel-list rows no deduction line already
//     covers — the same per-row rule the profit engine uses) = printed
//     total deductions;
//   - revenue lines = printed gross revenue;
//   - reimbursement lines = printed total reimbursements;
//   - gross + reimbursements − total deductions = printed net due.
// A check runs ONLY on totals the statement actually prints: a missing
// total skips that check — null never fails a check and is never guessed.
// Save stays blocked on a mismatch, with a "Save anyway, flagged
// needs-review" escape (app/(tabs)/import/index.tsx) so a real statement
// with an odd layout can never trap the user.
export type ReconciliationIssue =
  | { type: 'deductionsMismatch'; stated: number; summed: number }
  | { type: 'revenueLinesMismatch'; stated: number; summed: number }
  | { type: 'reimbursementLinesMismatch'; stated: number; summed: number }
  | { type: 'netDueMismatch'; stated: number; computed: number }
  // BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13): the
  // printed deposit is checked, never replaced — net due + interest income
  // must equal it within $1.
  | { type: 'depositMismatch'; stated: number; computed: number }
  | { type: 'zeroNetNonzeroGross'; grossRevenue: number };

export type ReconciliationResult = { ok: boolean; issues: ReconciliationIssue[] };

// Dollar tolerance — allows for benign cent-level rounding in the AI's own
// arithmetic, never enough to mask a genuinely missing line item (a truly
// missing item is almost always tens or hundreds of dollars).
const TOLERANCE = 1.0;

const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE;

// Deduction lines plus every fuel-list row no deduction line already
// covers (trueProfit.ts resolveFuelRows(), same per-row match the profit
// engine applies after save) — a statement whose fuel the extraction put
// only in the fuel list still adds up.
export function summedSettlementDeductions(s: NonNullable<Extraction['settlement']>): number {
  const KEY = 'this-settlement';
  const lines = (s.deductions ?? []).map((d) => ({
    amount: Number.isFinite(parseAmount(d.amount)) ? parseAmount(d.amount) : 0,
    description: d.desc ?? null,
    category: d.category ?? null,
    tax_deductible: false,
    settlement_id: KEY,
  }));
  const fuelRows = [
    ...(s.tractorFuel ?? []).map((f) => ({ f, fuel_type: 'tractor' })),
    ...(s.reeferFuel ?? []).map((f) => ({ f, fuel_type: 'reefer' })),
  ].map(({ f, fuel_type }) => ({
    amount: Number.isFinite(parseAmount(f.amount)) ? parseAmount(f.amount) : 0,
    discount: Number.isFinite(parseAmount(f.discount)) ? parseAmount(f.discount) : 0,
    settlement_id: KEY,
    fuel_type,
    purchase_date: null,
  }));
  const fuelNotOnLines = resolveFuelRows(fuelRows, lines).counted.reduce((sum, r) => sum + r.cost, 0);
  return lines.reduce((sum, d) => sum + d.amount, 0) + fuelNotOnLines;
}

export function checkSettlementReconciliation(extraction: Extraction | null | undefined): ReconciliationResult {
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) {
    return { ok: true, issues: [] };
  }
  const s = extraction.settlement;
  const issues: ReconciliationIssue[] = [];

  const gross = printedTotal(s.grossRevenue);
  const statedDeductions = printedTotal(s.totalDeductions);
  const statedReimbursements = printedTotal(s.reimbursements);
  const netDue = printedTotal(s.netPay);

  if (statedDeductions != null) {
    const summed = summedSettlementDeductions(s);
    if (differs(statedDeductions, summed)) issues.push({ type: 'deductionsMismatch', stated: statedDeductions, summed });
  }

  if (gross != null && (s.revenueItems ?? []).length > 0) {
    const summed = sumAmounts(s.revenueItems, (r) => r.amount);
    if (differs(gross, summed)) issues.push({ type: 'revenueLinesMismatch', stated: gross, summed });
  }

  if (statedReimbursements != null) {
    const summed = sumAmounts(s.reimbursementItems, (r) => r.amount);
    if (differs(statedReimbursements, summed)) {
      issues.push({ type: 'reimbursementLinesMismatch', stated: statedReimbursements, summed });
    }
  }

  // Net due: needs printed gross, total deductions and net. Reimbursements
  // are the printed total, else the reimbursement lines themselves, else 0
  // when the statement has none at all.
  if (gross != null && statedDeductions != null && netDue != null) {
    const reimbursements = statedReimbursements ?? sumAmounts(s.reimbursementItems, (r) => r.amount);
    const computed = gross + reimbursements - statedDeductions;
    if (differs(netDue, computed)) issues.push({ type: 'netDueMismatch', stated: netDue, computed });
  }

  const { deposit, depositSource } = printedDepositOf(extraction);
  if (deposit != null && depositSource !== 'net_due' && netDue != null) {
    const computed = netDue + printedInterestIncomeOf(extraction);
    if (differs(deposit, computed)) issues.push({ type: 'depositMismatch', stated: deposit, computed });
  }

  // A real settlement's net pay is essentially never EXACTLY $0.00 while
  // gross revenue is genuinely nonzero — that exact zero alongside nonzero
  // gross is the signature of a missing/never-reached net-pay figure.
  const grossRevenue = Number.isFinite(parseAmount(s.grossRevenue)) ? parseAmount(s.grossRevenue) : 0;
  if (grossRevenue !== 0 && netDue == null) {
    issues.push({ type: 'zeroNetNonzeroGross', grossRevenue });
  }

  return { ok: issues.length === 0, issues };
}

// "Save anyway, flagged needs-review" (owner decision 2026-10-13): the
// extraction is saved as-is but marked low-confidence — the existing
// needs-review signal (src/import/needsReview.ts, CLAUDE.md invariant #14)
// — with the failed checks kept in parsed_json for the audit trail.
export function flagReconciliationOverride(extraction: Extraction, issues: unknown[]): Extraction {
  return { ...extraction, confidence: 'low', reconciliationOverride: issues };
}
