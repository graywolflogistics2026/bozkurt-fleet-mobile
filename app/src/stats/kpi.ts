// KPI CONSISTENCY (owner decision) — device report: "three screens report
// three different numbers for the same week." Root cause, confirmed by
// tracing every screen's own computation: Home (via periodScopedCpm.ts),
// Scorecard (its own inline calcCanonicalCpm() + a separate, never-truck-
// scoped weekly trend), and AI Coach (proactiveCoach.ts's own THIRD ad-hoc
// calcCanonicalCpm() call, plus a "gross" sourced from a single settlement
// row while "net" was already fleet-aggregated) each independently
// assembled the "same" gross/expenses/net/miles/RPM/CPM/PPM figure from
// slightly different scope/window/truck-filtering choices — not one
// shared calculation with three presentations, but three real,
// independently-maintained calculations that could (and did) drift.
//
// computeKpis() is the ONE canonical entry point every screen now reads
// from for a "what are my numbers for this period+scope" question. It is
// deliberately a thin COMPOSITION over the already-correct, already-tested
// primitives this app spent many prior passes building — src/stats/
// truckComparison.ts's buildTruckComparison() (miles/CPM buckets) and
// src/stats/trueProfit.ts's sumCanonicalExpenses() (the ESTABLISHED,
// dominant "true profit" net figure Home's Hero Card / CEO Mode / Share
// Weekly Profit / Profit Analysis already all use) — never a second
// implementation of either.
//
// TWO DELIBERATELY DIFFERENT DOLLAR CONCEPTS, both real, both needed —
// discovered and reconciled by this pass's own cross-screen consistency
// test (kpiConsistency.test.ts), which caught an early draft silently
// conflating them:
//   1. `net` / `expenses.total` — the TRUE-PROFIT figure (gross minus
//      EVERY real deduction/fuel/maintenance/toll dollar, INCLUDING a
//      major one-off repair or vehicle purchase — a real dollar that was
//      really spent must still reduce real net profit). This is what
//      `net` means everywhere ELSE in this app already, and is what
//      "the same net for the same week" in the device report refers to.
//      `expenses.total` is defined as `gross - net`, so the two can never
//      disagree with each other.
//   2. `cpm` / `rpm` / `ppm` / `expenses.fixed` / `expenses.variable` /
//      `buckets` / `excludedOneOffs` — the deliberately NARROWER
//      per-mile operating-cost view (src/stats/cpm.ts's
//      calcCanonicalCpm(), Scorecard's own established "Why?" breakdown
//      convention): EXCLUDES a major one-off repair/vehicle purchase (so
//      a single big bill doesn't spike a per-mile ratio to something
//      meaningless) but INCLUDES the truck's own fixed cost-basis
//      estimate (a real recurring cost that has no deduction row at all
//      for a paid-off truck). `ppm` is always exactly `rpm - cpm` (the
//      literal fix for the reported "Net/Mile doesn't equal RPM - CPM"
//      bug) — but `ppm * miles` will NOT generally equal `net`, by
//      design, the same way `expenses.fixed + expenses.variable` will
//      NOT generally equal `expenses.total`. Both differences are the
//      SAME one-off/truck-basis divergence, named plainly here so no
//      future caller is surprised by it.
//
// For a SCOPED truck, `net` is that truck's own DIRECT expenses only —
// deliberately NEVER a share of fleet-level (no-truck_id) costs, per
// src/stats/costAllocation.ts's own explicit header comment: allocation
// is "for PER-TRUCK CPM purposes only (never for P&L/tax/true-profit...)".
import { calcMiles, resolveMilesTotal, type LoadMilesInput } from '@/src/stats/miles';
import { calcCanonicalCpm, carrierWithholdsLoanPayment, type CpmBucket, type CpmExcludedOneOff } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly } from '@/src/stats/truckCostBasis';
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';
import {
  buildTruckComparison,
  withAllocatedBucket,
  type ComparisonTruck,
  type ComparisonSettlement,
  type ComparisonDeduction,
  type ComparisonFuel,
  type ComparisonMaintenance,
  type ComparisonToll,
} from '@/src/stats/truckComparison';
import { filterRowsByDateWindow, type DateWindow } from '@/src/stats/heroPeriodWindow';
import { calcPerDiemDays } from '@/src/tax/perDiem';

export type { DateWindow };

// per_diem_days is optional (calcPerDiemDays() itself already falls back
// to the legacy flat 7 when a row has none — see its own comment) —
// deliberately NOT intersected with tax/perDiem.ts's own SettlementWeek
// type, which requires a non-null week_ending: ComparisonSettlement's
// week_ending is `string | null` (a settlement can, structurally, have no
// resolvable week yet), and forcing that narrower type here would make
// every real call site's settlement array fail to type-check.
type KpiSettlement = ComparisonSettlement & { per_diem_days?: number | null };
type KpiDeduction = ComparisonDeduction & { ded_date?: string | null };
type KpiFuel = ComparisonFuel & { purchase_date?: string | null };
type KpiMaintenance = ComparisonMaintenance & { service_date?: string | null };
type KpiToll = ComparisonToll & { toll_date?: string | null };

export type KpiInputs = {
  trucks: ComparisonTruck[];
  settlements: KpiSettlement[];
  loads: LoadMilesInput[];
  deductions: KpiDeduction[];
  fuelPurchases: KpiFuel[];
  maintenanceRecords: KpiMaintenance[];
  tolls: KpiToll[];
  // null = "All Trucks" scope (fleet-wide aggregate); a real id scopes
  // every figure to that one truck's own direct costs + (CPM fields
  // only) its allocated share of fleet-level (no-truck_id) costs.
  truckScope: string | null;
  manualMilesOverride?: number | null;
  // null = no time filtering at all ("all data passed in" — Scorecard's
  // own deliberately all-time design); a real window filters every input
  // row array identically before any computation.
  window: DateWindow | null;
};

export type KpiResult = {
  window: DateWindow | null;
  isAllTrucks: boolean;
  gross: number;
  // TRUE-PROFIT net (see this module's own header comment) — always
  // `gross - expenses.total`.
  net: number;
  // `total` is the TRUE-PROFIT expense total (gross - net, one-offs
  // INCLUDED). `fixed`/`variable` are the NARROWER per-mile-CPM
  // breakdown (one-offs EXCLUDED, the truck's own fixed cost basis
  // INCLUDED) — `fixed + variable` will NOT generally equal `total`, by
  // design; see this module's header comment for why both are real,
  // legitimately different figures.
  expenses: { total: number; fixed: number; variable: number };
  miles: { total: number; loaded: number; empty: number; deadheadPct: number | null };
  // null only when there are no miles in this window/scope (avoids a
  // divide-by-zero) — callers must show a "no data" state, never a $0.
  rpm: number | null;
  cpm: number | null;
  ppm: number | null;
  perDiemDays: number;
  settlementCount: number;
  duplicateWeeksIgnored: number;
  buckets: CpmBucket[];
  excludedTotal: number;
  excludedOneOffs: CpmExcludedOneOff[];
};

export function computeKpis(inputs: KpiInputs): KpiResult {
  const { trucks, loads, truckScope, manualMilesOverride, window } = inputs;

  // filterRowsByDateWindow returns [] for a null window (it's meant for
  // "no rows match" callers, not "pass everything through") — this
  // module's own `window: null` means the OPPOSITE ("no time filtering at
  // all"), so that helper is only invoked when a real window is given.
  const settlements = window ? filterRowsByDateWindow(inputs.settlements, (s) => s.week_ending, window) : inputs.settlements;
  const deductions = window ? filterRowsByDateWindow(inputs.deductions, (d) => d.ded_date, window) : inputs.deductions;
  const fuelPurchases = window ? filterRowsByDateWindow(inputs.fuelPurchases, (f) => f.purchase_date, window) : inputs.fuelPurchases;
  const maintenanceRecords = window
    ? filterRowsByDateWindow(inputs.maintenanceRecords, (m) => m.service_date, window)
    : inputs.maintenanceRecords;
  const tolls = window ? filterRowsByDateWindow(inputs.tolls, (t) => t.toll_date, window) : inputs.tolls;
  const settlementIds = new Set(settlements.map((s) => s.id));
  const filteredLoads = loads.filter((l) => l.settlement_id != null && settlementIds.has(l.settlement_id));

  const comparison = buildTruckComparison(trucks, settlements, filteredLoads, deductions, fuelPurchases, maintenanceRecords, tolls);
  const perDiemDays = calcPerDiemDays(
    settlements.filter((s): s is KpiSettlement & { week_ending: string } => s.week_ending != null)
  );

  if (truckScope) {
    const row = comparison.rows.find((r) => r.truckId === truckScope) ?? null;
    const truckSettlements = settlements.filter((s) => s.truck_id === truckScope);
    const dupWeeks = calcMiles(truckSettlements, filteredLoads).duplicateWeeksIgnored;
    // TRUE-PROFIT net (this module's header comment) — this truck's OWN
    // direct deductions/fuel/maintenance/tolls only, never a fleet-level
    // allocation (costAllocation.ts's own explicit "never for true-profit"
    // rule) and never the synthetic truck cost-basis estimate (true
    // profit only counts real recorded transactions).
    const truckDeductions = deductions.filter((d) => d.truck_id === truckScope);
    const truckFuel = fuelPurchases.filter((f) => f.truck_id === truckScope);
    const truckMaintenance = maintenanceRecords.filter((m) => m.truck_id === truckScope);
    const truckTolls = tolls.filter((t) => t.truck_id === truckScope);
    const grossRevenue = row?.grossRevenue ?? truckSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const trueExpenses = sumCanonicalExpenses(truckDeductions, truckFuel, truckMaintenance, truckTolls);
    const net = grossRevenue - trueExpenses;

    if (!row || !row.cpmBreakdown) {
      return {
        window,
        isAllTrucks: false,
        gross: grossRevenue,
        net,
        expenses: { total: trueExpenses, fixed: 0, variable: 0 },
        miles: { total: 0, loaded: 0, empty: 0, deadheadPct: null },
        rpm: null,
        cpm: null,
        ppm: null,
        perDiemDays,
        settlementCount: row?.settlementCount ?? truckSettlements.length,
        duplicateWeeksIgnored: dupWeeks,
        buckets: [],
        excludedTotal: 0,
        excludedOneOffs: [],
      };
    }
    const milesSource = resolveMilesTotal({ totalMiles: row.totalMiles }, manualMilesOverride);
    const withAlloc = withAllocatedBucket(row.cpmBreakdown, row.allocatedExpenses, milesSource.totalMiles);
    const emptyMiles = row.deadheadPct != null ? Math.round(row.deadheadPct * milesSource.totalMiles) : 0;
    // rpm/cpm/ppm are ALWAYS recomputed fresh against milesSource.totalMiles
    // (which may differ from row.totalMiles when a manual odometer/ELD
    // override is active) rather than trusted from withAlloc's own
    // revenuePerMile/costPerMile/profitPerMile fields — withAllocatedBucket()
    // only refreshes costPerMile when there's a real fleet-level allocation
    // to add (allocatedAmount > 0); when a truck has NO allocated share
    // (e.g. a single-truck account, allocatedExpenses always 0), it
    // short-circuits and returns the ORIGINAL row.cpmBreakdown's
    // costPerMile untouched — computed against the row's OWN build-time
    // totalMiles, not this override. Recomputing totalCost/totalMiles here
    // directly is what guarantees CPM (and therefore PPM = RPM - CPM) is
    // ALWAYS override-aware, in every case, not just when a fleet-level
    // allocation happens to exist.
    const cpmTotalCost = withAlloc.fixedTotal + withAlloc.variableTotal;
    const rpm = milesSource.totalMiles > 0 ? grossRevenue / milesSource.totalMiles : null;
    const cpmPerMile = milesSource.totalMiles > 0 ? cpmTotalCost / milesSource.totalMiles : null;
    const ppm = rpm != null && cpmPerMile != null ? rpm - cpmPerMile : null;
    return {
      window,
      isAllTrucks: false,
      gross: grossRevenue,
      net,
      expenses: { total: trueExpenses, fixed: withAlloc.fixedTotal, variable: withAlloc.variableTotal },
      miles: { total: milesSource.totalMiles, loaded: row.loadedMiles, empty: emptyMiles, deadheadPct: row.deadheadPct },
      rpm,
      cpm: cpmPerMile,
      ppm,
      perDiemDays,
      settlementCount: row.settlementCount,
      duplicateWeeksIgnored: dupWeeks,
      buckets: withAlloc.buckets,
      excludedTotal: withAlloc.excludedTotal,
      excludedOneOffs: withAlloc.excludedOneOffs,
    };
  }

  // "All Trucks" scope. gross/net/expenses.total use the SAME formula
  // src/stats/trueProfit.ts's calcTrueProfit() itself uses (sum every
  // settlement's gross, subtract sumCanonicalExpenses() of every
  // deduction/fuel/maintenance/toll row) — this is what makes Home's Hero
  // Card, AI Coach's weekly review, and this "All Trucks" figure provably
  // agree for the same window: they're the identical formula, not three
  // that happen to usually match.
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const trueExpenses = sumCanonicalExpenses(deductions, fuelPurchases, maintenanceRecords, tolls);
  const net = grossRevenue - trueExpenses;

  const carrierWithholdsLoan = carrierWithholdsLoanPayment(deductions);
  const fleetFixedCostTotal = trucks.reduce((sum, tr) => {
    const count = settlements.filter((s) => s.truck_id === tr.id).length;
    return sum + calcTruckCostBasisWeekly(tr, carrierWithholdsLoan).weeklyFixedTotal * count;
  }, 0);
  const milesResult = calcMiles(settlements, filteredLoads);
  const cpmResult = calcCanonicalCpm(
    grossRevenue,
    milesResult.totalMiles,
    deductions,
    fuelPurchases,
    maintenanceRecords,
    tolls,
    fleetFixedCostTotal
  );
  return {
    window,
    isAllTrucks: true,
    gross: grossRevenue,
    net,
    expenses: { total: trueExpenses, fixed: cpmResult.fixedTotal, variable: cpmResult.variableTotal },
    miles: { total: milesResult.totalMiles, loaded: milesResult.loadedMiles, empty: milesResult.emptyMiles, deadheadPct: milesResult.deadheadPct },
    rpm: cpmResult.revenuePerMile,
    cpm: cpmResult.costPerMile,
    ppm: cpmResult.profitPerMile,
    perDiemDays,
    settlementCount: settlements.length,
    duplicateWeeksIgnored: milesResult.duplicateWeeksIgnored,
    buckets: cpmResult.buckets,
    excludedTotal: cpmResult.excludedTotal,
    excludedOneOffs: cpmResult.excludedOneOffs,
  };
}
