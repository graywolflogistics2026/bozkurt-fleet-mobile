import type { Benchmark } from '@/src/types/db';
import { isDeductibleExpense } from '@/src/stats/trueProfit';

// Profit Analysis v1 (PROMPTS.md Session 9a item 11, CLAUDE.md invariant
// #22 — composed ONLY from the user's own account data, no external
// feeds). A trailing-N-day rollup (default 30) of revenue/fuel/maintenance/
// net plus the two ratio insights the benchmarks table (docs/PENDING_SQL.md
// §25) has reference ranges for.
export type ProfitAnalysisRollup = {
  windowDays: number;
  revenue: number;
  fuelExpense: number;
  maintenanceExpense: number;
  totalMiles: number;
  netIncome: number;
  fuelPctOfRevenue: number | null;
  maintenanceCostPerMile: number | null;
};

type SettlementLike = { week_ending: string; gross: number | null; net: number | null; miles: number | null };
type FuelLike = { purchase_date: string | null; amount: number | null; discount: number | null };
type MaintenanceLike = { service_date: string | null; cost: number | null };
type DeductionLike = { ded_date: string | null; amount: number | null; tax_deductible: boolean | null };

export function windowStartIso(windowDays: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - windowDays);
  return d.toISOString().slice(0, 10);
}

// TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): `netIncome` used
// to be sum(settlement.net) — settlement net PAY only, silently ignoring
// EVERY out-of-pocket deduction (not just fuel/maintenance, which this
// rollup already tracks as their own separate figures). Now the same
// canonical src/stats/trueProfit.ts formula (grossRevenue minus every
// deductible — tax_deductible !== false — deduction dated within the
// window) every other "profit" surface in the app uses.
export function buildProfitAnalysis(
  settlements: SettlementLike[],
  fuelPurchases: FuelLike[],
  maintenanceRecords: MaintenanceLike[],
  deductions: DeductionLike[],
  windowDays = 30,
  now: Date = new Date()
): ProfitAnalysisRollup {
  const start = windowStartIso(windowDays, now);

  const inWindow = settlements.filter((s) => (s.week_ending ?? '') >= start);
  const revenue = inWindow.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const deductibleExpenses = deductions
    .filter((d) => (d.ded_date ?? '') >= start && isDeductibleExpense(d))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const netIncome = revenue - deductibleExpenses;
  const totalMiles = inWindow.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);

  const fuelExpense = fuelPurchases
    .filter((f) => (f.purchase_date ?? '') >= start)
    .reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);

  const maintenanceExpense = maintenanceRecords
    .filter((m) => (m.service_date ?? '') >= start)
    .reduce((sum, m) => sum + Number(m.cost ?? 0), 0);

  return {
    windowDays,
    revenue,
    fuelExpense,
    maintenanceExpense,
    totalMiles,
    netIncome,
    fuelPctOfRevenue: revenue > 0 ? fuelExpense / revenue : null,
    maintenanceCostPerMile: totalMiles > 0 ? maintenanceExpense / totalMiles : null,
  };
}

export type RangeStatus = 'below_range' | 'in_range' | 'above_range' | 'no_benchmark';

export function compareToBenchmark(value: number | null, benchmark: Benchmark | null | undefined): RangeStatus {
  if (value == null || !benchmark) return 'no_benchmark';
  if (value < benchmark.low) return 'below_range';
  if (value > benchmark.high) return 'above_range';
  return 'in_range';
}
