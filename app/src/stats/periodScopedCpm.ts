// CPM/PPM BROKEN AGAIN — ROOT CAUSE FIX (owner decision, device report):
// the ONE shared orchestration every period-aware CPM display (currently
// Home's per-mile trio + its own "Why?" breakdown) reads from — resolves
// the Hero Card's selected period to a concrete date window
// (src/stats/heroPeriodWindow.ts) and delegates every actual computation
// to src/stats/kpi.ts's computeKpis() — the ONE canonical KPI function
// every screen (Home, Scorecard, AI Coach) now shares (KPI CONSISTENCY
// pass, owner decision). This module is kept as a thin, HeroPeriod-aware
// adapter (resolve period -> DateWindow -> computeKpis() -> re-shape into
// the {window, comparison, scopedRow, cpm} triple Home's existing render
// code already destructures) rather than folding directly into computeKpis
// itself, so Home's large, already-correct rendering code needed zero
// changes — the only thing that moved is WHERE the math actually happens.
import { buildTruckComparison, type ComparisonTruck, type ComparisonSettlement, type ComparisonDeduction, type ComparisonFuel, type ComparisonMaintenance, type ComparisonToll, type TruckComparisonResult, type TruckComparisonRow } from '@/src/stats/truckComparison';
import { computeKpis, type KpiResult } from '@/src/stats/kpi';
import type { CanonicalCpmResult } from '@/src/stats/cpm';
import { resolveHeroPeriodDateWindow, filterRowsByDateWindow, type DateWindow, type HeroPeriod } from '@/src/stats/heroPeriodWindow';

type DatedDeduction = ComparisonDeduction & { ded_date: string | null };
type DatedFuel = ComparisonFuel & { purchase_date: string | null };
type DatedMaintenance = ComparisonMaintenance & { service_date: string | null };
type DatedToll = ComparisonToll & { toll_date: string | null };
type LoadLike = { settlement_id: string | null; loaded_miles: number | null; empty_miles: number | null };

export type PeriodScopedCpmResult = {
  // null only when the period can't be resolved at all (e.g. "This Week"
  // on an account with zero settlements ever) — callers must show a
  // "no data for this window" state, never silently fall back to
  // all-time.
  window: DateWindow | null;
  comparison: TruckComparisonResult;
  // The active truck's own row within this window, or null in "All
  // Trucks" scope.
  scopedRow: TruckComparisonRow | null;
  // The final, display-ready CPM for the current scope — a scoped
  // truck's own direct+allocated figure (matching scopedRow exactly,
  // proven in truckComparison.test.ts), or the fleet-wide aggregate for
  // "All Trucks" scope. null when there's no window or no miles.
  cpm: CanonicalCpmResult | null;
  // KPI CONSISTENCY (owner decision) — the full canonical KpiResult this
  // window/scope produced, for any caller that wants the flat
  // gross/net/miles/rpm/cpm/ppm/perDiemDays shape directly instead of
  // picking fields back out of `comparison`/`cpm`.
  kpi: KpiResult | null;
};

export function buildPeriodScopedCpm(
  period: HeroPeriod,
  sortedWeekEndings: string[],
  trucks: ComparisonTruck[],
  settlements: ComparisonSettlement[],
  loads: LoadLike[],
  deductions: DatedDeduction[],
  fuelPurchases: DatedFuel[],
  maintenanceRecords: DatedMaintenance[],
  tolls: DatedToll[],
  activeTruckId: string | null,
  manualMilesOverride: number | null | undefined,
  now: Date = new Date()
): PeriodScopedCpmResult {
  const window = resolveHeroPeriodDateWindow(period, sortedWeekEndings, now);

  // Still built directly here (not just inside computeKpis) because
  // callers (Home) need the FULL TruckComparisonResult — every truck's
  // own row, the Unassigned row, fleetTotals — for the "All Trucks"
  // per-truck breakdown card, not just the scoped figure computeKpis()
  // itself returns.
  const fSettlements = filterRowsByDateWindow(settlements, (s) => s.week_ending, window);
  const fSettlementIds = new Set(fSettlements.map((s) => s.id));
  const fLoads = loads.filter((l) => l.settlement_id != null && fSettlementIds.has(l.settlement_id));
  const fDeductions = filterRowsByDateWindow(deductions, (d) => d.ded_date, window);
  const fFuel = filterRowsByDateWindow(fuelPurchases, (f) => f.purchase_date, window);
  const fMaintenance = filterRowsByDateWindow(maintenanceRecords, (m) => m.service_date, window);
  const fTolls = filterRowsByDateWindow(tolls, (t) => t.toll_date, window);

  const comparison = buildTruckComparison(trucks, fSettlements, fLoads, fDeductions, fFuel, fMaintenance, fTolls);
  const scopedRow = activeTruckId ? (comparison.rows.find((r) => r.truckId === activeTruckId) ?? null) : null;

  if (!window) {
    return { window: null, comparison, scopedRow, cpm: null, kpi: null };
  }

  const kpi = computeKpis({
    trucks,
    settlements,
    loads,
    deductions,
    fuelPurchases,
    maintenanceRecords,
    tolls,
    truckScope: activeTruckId,
    manualMilesOverride,
    window,
  });

  if (scopedRow) {
    if (!scopedRow.cpmBreakdown) return { window, comparison, scopedRow, cpm: null, kpi };
    const cpm: CanonicalCpmResult = {
      revenuePerMile: kpi.rpm,
      costPerMile: kpi.cpm,
      profitPerMile: kpi.ppm,
      buckets: kpi.buckets,
      excludedTotal: kpi.excludedTotal,
      excludedOneOffs: kpi.excludedOneOffs,
      fixedTotal: kpi.expenses.fixed,
      variableTotal: kpi.expenses.variable,
      fixedCostPerMile: kpi.miles.total > 0 ? kpi.expenses.fixed / kpi.miles.total : null,
      variableCostPerMile: kpi.miles.total > 0 ? kpi.expenses.variable / kpi.miles.total : null,
    };
    return { window, comparison, scopedRow, cpm, kpi };
  }

  // "All Trucks" scope — same fleet-wide calcCanonicalCpm() shape every
  // prior pass established, now sourced from computeKpis() (which itself
  // pro-rates each truck's own fixed cost to however many of ITS settlement
  // weeks actually fall in the window).
  const cpm: CanonicalCpmResult = {
    revenuePerMile: kpi.rpm,
    costPerMile: kpi.cpm,
    profitPerMile: kpi.ppm,
    buckets: kpi.buckets,
    excludedTotal: kpi.excludedTotal,
    excludedOneOffs: kpi.excludedOneOffs,
    fixedTotal: kpi.expenses.fixed,
    variableTotal: kpi.expenses.variable,
    fixedCostPerMile: kpi.miles.total > 0 ? kpi.expenses.fixed / kpi.miles.total : null,
    variableCostPerMile: kpi.miles.total > 0 ? kpi.expenses.variable / kpi.miles.total : null,
  };
  return { window, comparison, scopedRow: null, cpm, kpi };
}
