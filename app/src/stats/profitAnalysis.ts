import type { Benchmark } from '@/src/types/db';
import { canonicalExpenseBreakdown } from '@/src/stats/trueProfit';

// Profit Analysis v1 (PROMPTS.md Session 9a item 11, CLAUDE.md invariant
// #22 — composed ONLY from the user's own account data, no external
// feeds). A rollup of revenue/fuel/maintenance/net for a caller-supplied
// date range, plus the two ratio insights the benchmarks table
// (docs/PENDING_SQL.md §25) has reference ranges for.
//
// "GHOST VALUE" pass (owner decision 2026-08-28, device report: "Profit
// Analysis shows -$1,372.98, but the Deductions screen's own total is
// $5,800.72 — these must reconcile and they clearly don't"). Traced end
// to end: this was NEVER a caching/staleness bug — the screen's own
// useMemo already recomputed fresh from live React Query data on every
// render (app/(tabs)/more/profit-analysis.tsx's rollup useMemo, keyed on
// settlementsQuery.data/dedQuery.data/etc.). The real cause was a WINDOW
// mismatch: this function was hardcoded to a rolling trailing-30-day
// window (`windowDays = 30` below, unconditionally) while the Deductions
// screen's own "Total" tile defaults to the 'all' period (no lower
// bound) — two structurally different quantities besides the date range
// too (Deductions' Total is every deduction row's amount, unconditional;
// this rollup's netIncome subtracts the SAME canonical
// deductionsTotal+fuelTotal+maintenanceTotal+tollsTotal
// canonicalExpenseBreakdown() every other "true profit" screen already
// shares, excluding Meals/Advance Repayment/Escrow & Deposits per
// reducesTrueProfit()). Fixed two ways: (1) `startIso` is now an
// explicit caller-supplied lower bound (or `null` for no bound) instead
// of a baked-in day count — the screen now offers the SAME period
// selector (This Month/3M/YTD/All, src/stats/periodFilter.ts) Deductions/
// Settlements already use, defaulting to 'all' so the two screens agree
// by default; (2) the return value now exposes the FULL reconciliation
// breakdown (deductionsGrossTotal/deductionsExcludedTotal/
// deductionsCountedTotal/canonicalFuelExpense/tollsExpense/
// totalExpenses) so "Total Expenses" is never a black box next to
// Deductions' own "Total" — the screen renders the actual arithmetic
// connecting the two, for whatever period is currently selected.
export type ProfitAnalysisRollup = {
  startIso: string | null;
  endIso: string;
  revenue: number;
  fuelExpense: number;
  maintenanceExpense: number;
  totalMiles: number;
  netIncome: number;
  fuelPctOfRevenue: number | null;
  maintenanceCostPerMile: number | null;
  // RECONCILIATION BREAKDOWN — every figure below sums to `totalExpenses`
  // (= revenue - netIncome exactly), and deductionsGrossTotal is the SAME
  // unconditional sum Deductions' own "Total" tile shows for an identical
  // date range (src/stats/deductionsSummary.ts's buildDeductionsTotalsBar()).
  deductionsGrossTotal: number;
  deductionsExcludedTotal: number;
  deductionsCountedTotal: number;
  canonicalFuelExpense: number;
  tollsExpense: number;
  totalExpenses: number;
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
  startIso: string | null,
  now: Date = new Date(),
  tolls: TollLike[] = []
): ProfitAnalysisRollup {
  // Explicit upper bound too (`<= end`), matching computeKpis()'s own
  // [startIso, endIso] inclusive window filtering exactly — a future-dated
  // row shouldn't normally exist in real data, but this keeps the two
  // filtering rules structurally identical rather than merely usually
  // agreeing. `startIso === null` means no lower bound at all (the 'all'
  // period) — mirrors src/stats/periodFilter.ts's own periodStartIso('all').
  const end = now.toISOString().slice(0, 10);
  const inRange = (d: string | null | undefined) => !!d && (startIso == null || d >= startIso) && d <= end;

  const inWindow = settlements.filter((s) => inRange(s.week_ending));
  const revenue = inWindow.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const windowDeductions = deductions.filter((d) => inRange(d.ded_date));
  const windowFuel = fuelPurchases.filter((f) => inRange(f.purchase_date));
  const windowMaintenance = maintenanceRecords.filter((m) => inRange(m.service_date));
  const windowTolls = tolls.filter((t) => inRange(t.toll_date));

  const breakdown = canonicalExpenseBreakdown(windowDeductions, windowFuel, windowMaintenance, windowTolls);
  const netIncome = revenue - breakdown.total;
  const totalMiles = inWindow.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);

  // fuelExpense/maintenanceExpense stay the FULL totals (every purchase/
  // record in range, settlement-linked fuel included) — a deliberately
  // wider display tile than what's actually subtracted into netIncome
  // (canonicalFuelExpense below), per this file's own pre-existing "how
  // much fuel did I buy" vs. "how much reduced my net profit" distinction.
  const fuelExpense = windowFuel.reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);
  const maintenanceExpense = windowMaintenance.reduce((sum, m) => sum + Number(m.cost ?? 0), 0);
  const deductionsGrossTotal = windowDeductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return {
    startIso,
    endIso: end,
    revenue,
    fuelExpense,
    maintenanceExpense,
    totalMiles,
    netIncome,
    fuelPctOfRevenue: revenue > 0 ? fuelExpense / revenue : null,
    maintenanceCostPerMile: totalMiles > 0 ? maintenanceExpense / totalMiles : null,
    deductionsGrossTotal,
    deductionsExcludedTotal: deductionsGrossTotal - breakdown.deductionsTotal,
    deductionsCountedTotal: breakdown.deductionsTotal,
    canonicalFuelExpense: breakdown.fuelTotal,
    tollsExpense: breakdown.tollsTotal,
    totalExpenses: breakdown.total,
  };
}

export type RangeStatus = 'below_range' | 'in_range' | 'above_range' | 'no_benchmark';

export function compareToBenchmark(value: number | null, benchmark: Benchmark | null | undefined): RangeStatus {
  if (value == null || !benchmark) return 'no_benchmark';
  if (value < benchmark.low) return 'below_range';
  if (value > benchmark.high) return 'above_range';
  return 'in_range';
}
