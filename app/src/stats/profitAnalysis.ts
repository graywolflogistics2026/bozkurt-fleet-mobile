import type { Benchmark } from '@/src/types/db';
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';

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
type TollLike = { toll_date: string | null; amount: number | null };
type DeductionLike = {
  ded_date: string | null;
  amount: number | null;
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
};

// ONE KPI ENGINE (owner decision, device report: "Profit Analysis shows
// Net Income $1,372, independent of what Dashboard/Scorecard/AI Coach
// show for the same period and scope"). Root cause traced to this
// function specifically: it used UTC-based date arithmetic
// (`setUTCDate`) while `src/stats/heroPeriodWindow.ts`'s
// `resolveHeroPeriodDateWindow()` — the ONE shared window resolver every
// computeKpis() consumer (Home's "1M" tab, Scorecard, AI Coach) uses for
// an identical "trailing 30 days" period — uses LOCAL-time arithmetic
// (`setDate`). For a timezone that observes DST, a 30/90/180/365-day
// window spanning a DST transition can land on a genuinely different UTC
// calendar day between the two methods (the same "MONTH FILTER
// OFF-BY-ONE" UTC-vs-local mismatch class this codebase has hit before —
// src/i18n/format.ts's formatMonthLabel()). Now uses the IDENTICAL
// local-time arithmetic resolveHeroPeriodDateWindow() uses, so a
// windowDays=30 call here can never diverge from Home's own "1M" period
// boundary again. The formula itself (revenue minus sumCanonicalExpenses())
// already matched computeKpis()'s `net` exactly — the window boundary was
// the only real divergence.
export function windowStartIso(windowDays: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - windowDays);
  return d.toISOString().slice(0, 10);
}

// TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31, extended 2026-08-05
// FULL PARITY pass item C.2): `netIncome` used to be sum(settlement.net)
// — settlement net PAY only, silently ignoring EVERY out-of-pocket
// deduction. Fixed then to use `reducesTrueProfit()` on `deductions`
// alone — but that STILL silently ignored this rollup's own
// `fuelExpense`/`maintenanceExpense` figures (computed and DISPLAYED as
// their own tiles, but never actually subtracted into `netIncome`) and
// never had a `tolls` input at all. Now uses the SAME canonical
// `sumCanonicalExpenses()` (src/stats/trueProfit.ts) every other
// "profit" surface in the app shares — fuel/maintenance/tolls all
// genuinely reduce `netIncome` here too. Note: `sumCanonicalExpenses()`
// excludes a SETTLEMENT-LINKED fuel_purchases row from the total it
// subtracts (its cost is already represented by the settlement's own
// withheld deductions) — the `fuelExpense` TILE below is deliberately
// still the FULL fuel total (every purchase, settlement-linked or not),
// since "how much fuel did I buy" is a different, wider question than
// "how much of that reduced my net profit."
export function buildProfitAnalysis(
  settlements: SettlementLike[],
  fuelPurchases: FuelLike[],
  maintenanceRecords: MaintenanceLike[],
  deductions: DeductionLike[],
  windowDays = 30,
  now: Date = new Date(),
  tolls: TollLike[] = []
): ProfitAnalysisRollup {
  const start = windowStartIso(windowDays, now);
  // Explicit upper bound too (`<= end`), matching computeKpis()'s own
  // [startIso, endIso] inclusive window filtering exactly — a future-dated
  // row shouldn't normally exist in real data, but this keeps the two
  // filtering rules structurally identical rather than merely usually
  // agreeing.
  const end = now.toISOString().slice(0, 10);

  const inWindow = settlements.filter((s) => (s.week_ending ?? '') >= start && (s.week_ending ?? '') <= end);
  const revenue = inWindow.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const windowDeductions = deductions.filter((d) => (d.ded_date ?? '') >= start && (d.ded_date ?? '') <= end);
  const windowFuel = fuelPurchases.filter((f) => (f.purchase_date ?? '') >= start && (f.purchase_date ?? '') <= end);
  const windowMaintenance = maintenanceRecords.filter((m) => (m.service_date ?? '') >= start && (m.service_date ?? '') <= end);
  const windowTolls = tolls.filter((t) => (t.toll_date ?? '') >= start && (t.toll_date ?? '') <= end);
  const trueExpenses = sumCanonicalExpenses(windowDeductions, windowFuel, windowMaintenance, windowTolls);
  const netIncome = revenue - trueExpenses;
  const totalMiles = inWindow.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);

  const fuelExpense = windowFuel.reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);

  const maintenanceExpense = windowMaintenance.reduce((sum, m) => sum + Number(m.cost ?? 0), 0);

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
