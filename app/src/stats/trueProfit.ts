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

export function calcTrueProfit(
  settlements: Array<{ gross: number | null }>,
  deductions: Array<{ amount: number | null; tax_deductible: boolean | null }>
): number {
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const deductibleExpenses = deductions
    .filter(isDeductibleExpense)
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  return grossRevenue - deductibleExpenses;
}

// Same {weekEnding, gross, net} shape as cashFlowTrend.ts's
// buildWeeklyTrend() — a deliberate drop-in replacement wherever `.net`
// was being read as "profit" rather than literally "this settlement's
// own net pay field." `net` here is calcTrueProfit()'s figure for that
// week's settlements + deductions dated within the settlement's 7-day
// window (weekStartFromEnding..weekEnding, same window
// buildWeeklyRevenueExpenseTrend uses), not the settlement row's own
// `net` column.
export type TrueProfitWeeklyPoint = { weekEnding: string; gross: number; net: number };

export function buildWeeklyTrueProfitTrend(settlements: Settlement[], deductions: Deduction[]): TrueProfitWeeklyPoint[] {
  const weekEndings = [...new Set(settlements.filter((s) => s.week_ending).map((s) => s.week_ending as string))].sort();

  return weekEndings.map((weekEnding) => {
    const weekSettlements = settlements.filter((s) => s.week_ending === weekEnding);
    const gross = weekSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const start = weekStartFromEnding(weekEnding);
    const weekDeductions = deductions.filter((d) => d.ded_date && d.ded_date >= start && d.ded_date <= weekEnding);
    const deductibleExpenses = weekDeductions
      .filter(isDeductibleExpense)
      .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    return { weekEnding, gross, net: gross - deductibleExpenses };
  });
}
