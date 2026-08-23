import type { Deduction, Settlement } from '@/src/types/db';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';

// TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31, follow-up to the
// UX mega-pass's Net-to-Owner audit fix): the ONE canonical "what does
// the owner actually net" calculation — Home, Scorecard's own weekly
// trend, CEO Mode / AI Coach, Share Weekly Profit, and Profit Analysis
// all consume this instead of each computing (or mis-computing) their
// own version.
//
// profit = grossRevenue − every REAL deductible expense (withheld +
// out-of-pocket alike), computed by starting from GROSS rather than a
// settlement's own `net` field. Two things this gets right that the
// screens it replaces did not:
//
// 1. NEVER double-counts or under-counts withheld chargebacks. Starting
//    from `net` (gross minus withheld deductions already baked in) and
//    then ALSO subtracting out-of-pocket deductions is CLAUDE.md
//    invariant #1's tax-model shortcut; starting from GROSS and
//    subtracting every deduction row (withheld + out-of-pocket) once
//    produces the identical number a different way (verified equal by
//    src/stats/profitLoss.ts's own header comment — "gross - withheld
//    already equals settlement net by definition"). This module always
//    takes the GROSS route so a caller never has to reason about which
//    rows are already "in" a settlement's `net`.
// 2. EXCLUDES deductions marked `tax_deductible: false` — a Meal already
//    covered by the per diem allowance, or an Advance Repayment (CLAUDE.md's
//    NON_DEDUCTIBLE_CATEGORIES, src/import/category.ts). An advance
//    repayment is literally returning already-received money, never a
//    real expense; a per-diem-covered meal receipt would double-count
//    against the per diem allowance if also subtracted here. The prior
//    Dashboard "Net to Owner" fix (UX mega-pass) used grossRevenue −
//    ALL deductions unconditionally, which OVER-subtracted these two
//    categories when present — this module is the corrected version.
//
// Deliberately NOT used by src/stats/profitLoss.ts's buildProfitLoss()
// (Operating P&L, a verbatim legacy rOper() port — counts every
// deduction unconditionally, by design, for accountant/legacy-parity
// purposes) or src/stats/scorecard.ts's calcScorecard() (a verbatim
// legacy rScore() port, same "operating" ALL-deductions definition by
// design). Those two stay exactly as documented — this module is for
// every OTHER "what's my profit" figure in the app.
export function isDeductibleExpense(d: { tax_deductible: boolean | null }): boolean {
  return d.tax_deductible !== false;
}

// CRITICAL BUG FIX (device feedback 2026-07-31, "Cash Flow shows revenue
// with none of the settlement's expenses subtracted"): mapSettlement()
// stamps EVERY settlement-withheld row tax_deductible:false unconditionally
// (CLAUDE.md invariant #1 defense-in-depth, so a withheld chargeback is
// never double-counted as a TAX deduction) — but isDeductibleExpense() was
// also being used here to decide whether a row reduces TRUE PROFIT, which
// is a different question. That made calcTrueProfit() silently skip every
// withheld dollar (fuel advance, insurance, ELD fees, tolls, escrow...)
// instead of subtracting it, exactly contradicting this file's own header
// comment ("gross - every deduction row, withheld + out-of-pocket, once").
// A withheld row genuinely left the settlement check — it must count —
// UNLESS it's one of three specific non-expense categories: a per-diem-
// covered meal (owner decision 2026-07-17, already covered by the per
// diem allowance, never a new expense), an Advance Repayment (owner
// decision 2026-07-17, loan principal being returned, not a new expense
// either), or Escrow & Deposits (owner decision 2026-08-02, verified
// against a real statement with a "PERFORMNCE BOND" line — a performance
// bond/escrow reserve/tire fund/emergency fund/maintenance reserve is a
// REFUNDABLE DEPOSIT the carrier holds, not a cost that reduces profit).
// These three stay excluded regardless of source; every other withheld
// row still counts.
const TRUE_PROFIT_EXCLUDED_CATEGORIES = new Set(['Meals (per diem covered)', 'Advance Repayment', 'Escrow & Deposits']);

export function reducesTrueProfit(d: {
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
}): boolean {
  if (TRUE_PROFIT_EXCLUDED_CATEGORIES.has(d.category ?? '')) return false;
  if (d.source === 'settlement') return true;
  return isDeductibleExpense(d);
}

// FULL PARITY pass (owner decision 2026-08-05, spec item C.2 "ONE
// CANONICAL EXPENSE ENGINE... INCLUDING fuel, maintenance and tolls — the
// dashboard total must never be just the deductions table"). Audit
// finding: fuel_purchases/maintenance_records/tolls are their OWN tables,
// never mirrored into `deductions` — a standalone (non-settlement) fuel
// receipt, maintenance invoice, or toll charge was a REAL out-of-pocket
// cost that calcTrueProfit()/calcCpm()/buildProfitLoss() ALL silently
// missed entirely, since every one of them only ever summed `deductions`.
// (`src/stats/accountantPackage.ts`'s buildAccountantPackage() already
// folds fuel_purchases/maintenance_records in — this is what extends that
// same fix to every OTHER "what's my profit/cost" figure in the app, per
// the spec's explicit "one canonical engine" requirement.)
//
// DOUBLE-COUNT GUARD, fuel only: a settlement's own withheld deductions
// can include a `fuel_advance` chargeback (→ category 'Fuel & DEF') —
// an informational categorization of the SAME underlying fuel cost that
// ALSO has its own itemized row(s) in fuel_purchases (mapSettlement()
// stamps a settlement-derived fuel_purchases row's `settlement_id`,
// aiImportSave.ts). Counting both would double the real cost, so a
// SETTLEMENT-LINKED fuel_purchases row (settlement_id set) is excluded
// here — its cost is already represented by the settlement's own
// withheld deductions, exactly as `reducesTrueProfit()` already decided.
// Only STANDALONE fuel (settlement_id null — a fuel receipt imported on
// its own, never previously reflected anywhere) is added. tolls/
// maintenance_records have no settlement_id column at all to filter by —
// same as `buildAccountantPackage()`'s own established precedent, they're
// added unconditionally; the corresponding `tolls_transponder` chargeback
// (rare in practice — most carriers bill toll-transponder fees as a flat
// rental fee, not a per-toll pass-through) is an accepted, pre-existing
// class of edge case, not a regression this pass introduces.

type CanonicalFuel = { amount: number | null; discount?: number | null; settlement_id?: string | null };
type CanonicalMaintenance = { cost: number | null };
type CanonicalToll = { amount: number | null };
type CanonicalDeduction = { amount: number | null; source?: string | null; category?: string | null; tax_deductible: boolean | null };

// Exported so every OTHER "what's my profit/cost" module (currently
// src/stats/profitAnalysis.ts's buildProfitAnalysis()) can share the
// exact same canonical total instead of re-deriving its own — the whole
// point of spec item C.2's "ONE canonical expense engine."
export function sumCanonicalExpenses(
  deductions: CanonicalDeduction[],
  fuelPurchases: CanonicalFuel[],
  maintenanceRecords: CanonicalMaintenance[],
  tolls: CanonicalToll[]
): number {
  const dedTotal = deductions.filter(reducesTrueProfit).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const fuelTotal = fuelPurchases
    .filter((f) => !f.settlement_id)
    .reduce((sum, f) => sum + Math.max(0, Number(f.amount ?? 0) - Number(f.discount ?? 0)), 0);
  const maintTotal = maintenanceRecords.reduce((sum, m) => sum + Number(m.cost ?? 0), 0);
  const tollsTotal = tolls.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  return dedTotal + fuelTotal + maintTotal + tollsTotal;
}

export function calcTrueProfit(
  settlements: Array<{ gross: number | null }>,
  deductions: CanonicalDeduction[],
  fuelPurchases: CanonicalFuel[] = [],
  maintenanceRecords: CanonicalMaintenance[] = [],
  tolls: CanonicalToll[] = []
): number {
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const trueExpenses = sumCanonicalExpenses(deductions, fuelPurchases, maintenanceRecords, tolls);
  return grossRevenue - trueExpenses;
}

// Same {weekEnding, gross, net} shape as cashFlowTrend.ts's
// buildWeeklyTrend() — a deliberate drop-in replacement wherever `.net`
// was being read as "profit" rather than literally "this settlement's
// own net pay field." `net` here is calcTrueProfit()'s figure for that
// week's settlements + deductions/fuel/maintenance/tolls dated within the
// settlement's 7-day window (weekStartFromEnding..weekEnding, same
// window buildWeeklyRevenueExpenseTrend uses), not the settlement row's
// own `net` column. fuelPurchases/maintenanceRecords/tolls default to
// `[]` so existing callers keep compiling/working exactly as before while
// each screen is migrated to pass real data (spec item C.2).
export type TrueProfitWeeklyPoint = { weekEnding: string; gross: number; net: number };

export function buildWeeklyTrueProfitTrend(
  settlements: Settlement[],
  deductions: Deduction[],
  fuelPurchases: Array<CanonicalFuel & { purchase_date?: string | null }> = [],
  maintenanceRecords: Array<CanonicalMaintenance & { service_date?: string | null }> = [],
  tolls: Array<CanonicalToll & { toll_date?: string | null }> = []
): TrueProfitWeeklyPoint[] {
  const weekEndings = [...new Set(settlements.filter((s) => s.week_ending).map((s) => s.week_ending as string))].sort();

  return weekEndings.map((weekEnding) => {
    const weekSettlements = settlements.filter((s) => s.week_ending === weekEnding);
    const gross = weekSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const start = weekStartFromEnding(weekEnding);
    const inWindow = (dateStr: string | null | undefined) => !!dateStr && dateStr >= start && dateStr <= weekEnding;
    const weekDeductions = deductions.filter((d) => inWindow(d.ded_date));
    const weekFuel = fuelPurchases.filter((f) => inWindow(f.purchase_date));
    const weekMaintenance = maintenanceRecords.filter((m) => inWindow(m.service_date));
    const weekTolls = tolls.filter((t) => inWindow(t.toll_date));
    const trueExpenses = sumCanonicalExpenses(weekDeductions, weekFuel, weekMaintenance, weekTolls);
    return { weekEnding, gross, net: gross - trueExpenses };
  });
}
