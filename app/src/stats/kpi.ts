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
// from for a "what are my numbers for this period+scope" question.
//
// TWO DELIBERATELY DIFFERENT DOLLAR CONCEPTS, both real, both needed —
// discovered and reconciled by this pass's own cross-screen consistency
// test (kpiConsistency.test.ts), which caught an early draft silently
// conflating them:
//   1. `net` / `expenses.total` — the TRUE-PROFIT figure (gross minus
//      EVERY real deduction/fuel/maintenance/toll dollar, INCLUDING a
//      major one-off repair or vehicle purchase — a real dollar that was
//      really spent must still reduce real net profit). This is what
//      `net` means everywhere ELSE in this app already (calcTrueProfit()).
//   2. `cpm` / `rpm` / `ppm` / `expenses.fixed` / `expenses.variable` /
//      `buckets` / `excludedOneOffs` — the deliberately NARROWER
//      per-mile operating-cost view (src/stats/cpm.ts's
//      calcCanonicalCpm()): EXCLUDES a major one-off repair/vehicle
//      purchase (so a single big bill doesn't spike a per-mile ratio to
//      something meaningless) but INCLUDES the truck's own fixed
//      cost-basis estimate. `ppm` is always exactly `rpm − cpm`.
//
// NULL-TRUCK EXCLUSION FIX (owner decision, device report: "the new KPI
// engine is dropping most of my data" — expenses reading $0, Scorecard
// miles reading ~30% of the real fleet total, the Weekly Net Trend
// showing 2 of 6 settlement weeks). ROOT CAUSE, confirmed by re-reading
// this module's own first draft: the SCOPED-truck branch filtered every
// row array by PLAIN EQUALITY (`row.truck_id === truckScope`) — the
// EXACT SAME mistake already found and fixed once in entityHooks.ts's
// applyFilters() ("MULTI-TRUCK MODEL — NULL-TRUCK EXCLUSION FIX") and in
// src/stats/loadsScope.ts, reintroduced here in the new canonical path.
// SQL equality never matches a NULL row, and CLAUDE.md's own §63 entry is
// explicit that "most deductions stay fleet-level (null) by design" —
// worse, `ActiveTruckContext`'s n=1 shortcut means a SINGLE-TRUCK account
// (the overwhelmingly common case) ALWAYS has a real, non-null
// `truckScope` (there is no "All Trucks" picker to fall back to), so
// EVERY null-truck settlement/deduction/fuel/maintenance/toll row —
// anything imported before a truck record existed, or left unassigned —
// was silently excluded from that user's own Scorecard/Dashboard, not
// just a rare multi-truck edge case. `matchesTruckScope()` below is the
// ONE shared predicate this module uses everywhere a truck-scoped filter
// is needed — mirroring entityHooks.ts's own established rule exactly: a
// null-truck row is never "genuinely truck-specific" to some OTHER
// truck, so including it in a specific truck's own scoped view can never
// leak another truck's data, only ever restore a fleet-level row's
// visibility (the same accepted tradeoff entityHooks.ts already
// documented: in a genuine multi-truck account, a still-unassigned row
// will show up under EVERY truck's own individual scope until it's fixed
// via the Truck Assignments repair screen — silently dropping real data
// is strictly worse than that, per CLAUDE.md's own "no dollar silently
// lost" principle).
//
// This is also why computeKpis() no longer delegates to src/stats/
// truckComparison.ts's buildTruckComparison() for its own scoped-branch
// math — that function's own `buildTruckRow()` uses the SAME plain-
// equality filter, by design, for ITS OWN purpose (the Per-Truck
// Profitability screen's deliberate "Unassigned" row + mile-proportional
// ALLOCATION of fleet-level costs across real trucks — a genuinely
// different, still-correct concept for THAT screen, left completely
// untouched here). computeKpis() now filters+computes directly for both
// branches through one shared code path, so "All Trucks" and "a specific
// truck" can never diverge in how they treat a null-truck row.
import { calcMiles, resolveMilesTotal, type LoadMilesInput } from '@/src/stats/miles';
import { calcCanonicalCpm, carrierWithholdsLoanPayment, type CpmBucket, type CpmExcludedOneOff } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly } from '@/src/stats/truckCostBasis';
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';
import type { ComparisonTruck, ComparisonSettlement, ComparisonDeduction, ComparisonFuel, ComparisonMaintenance, ComparisonToll } from '@/src/stats/truckComparison';
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
  // every figure to that one truck's own rows PLUS every null-truck row
  // (see this module's header comment — never a plain-equality exclusion).
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

// NULL-TRUCK EXCLUSION FIX — see this module's header comment. `null`
// truckScope means "All Trucks," matching every row unconditionally.
// Exported so every OTHER screen-local "scope this row array to the
// active truck" filter (app/(tabs)/index.tsx's own scopedSettlements/
// scopedDeductions/scopedFuel/scopedMaintenance/scopedTolls,
// scorecard.tsx's equivalents) can share this exact same rule instead of
// each hand-rolling its own plain-equality filter, which is precisely how
// this bug was reintroduced in the first place.
export function matchesTruckScope(rowTruckId: string | null | undefined, truckScope: string | null): boolean {
  if (!truckScope) return true;
  return rowTruckId === truckScope || rowTruckId == null;
}

// EXPENSES READING $0 / SILENT-ZERO GUARD (owner decision, device report
// item: "an optional parameter that defaults to [] would produce exactly
// this... a zero expense figure in accounting software is never an
// acceptable silent default"). computeKpis() has no optional expense-
// source parameters — every one of settlements/loads/deductions/
// fuelPurchases/maintenanceRecords/tolls/trucks is REQUIRED by its own
// TypeScript type, which already catches a missing argument at compile
// time for every real call site in this app. This function is the
// runtime backstop for the cases TypeScript can't catch: a caller
// passing `undefined` through an `as any` cast, a stale value captured
// before a query resolved, or the wrong shape entirely (e.g. the whole
// react-query result object, `{ data: [...] }`, passed instead of the
// plain array). There is no sensible "log and continue" recovery for a
// pure calculation function — returning a zero-filled result IS the bug
// this guard exists to prevent — so this always throws, in every
// environment, rather than only in development.
function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `computeKpis(): "${name}" must be an array, received ${value === undefined ? 'undefined' : value === null ? 'null' : typeof value}. ` +
        `This usually means a missing "?? []" fallback on a query result that hasn't loaded yet, a query object ({ data, isLoading, ... }) ` +
        `passed instead of its .data array, or an await that was dropped. Returning $0 here would silently misreport real financial data — ` +
        `fix the caller instead of catching this.`
    );
  }
}

export function computeKpis(inputs: KpiInputs): KpiResult {
  assertArray(inputs.trucks, 'trucks');
  assertArray(inputs.settlements, 'settlements');
  assertArray(inputs.loads, 'loads');
  assertArray(inputs.deductions, 'deductions');
  assertArray(inputs.fuelPurchases, 'fuelPurchases');
  assertArray(inputs.maintenanceRecords, 'maintenanceRecords');
  assertArray(inputs.tolls, 'tolls');

  const { trucks, loads, truckScope, manualMilesOverride, window } = inputs;

  // filterRowsByDateWindow returns [] for a null window (it's meant for
  // "no rows match" callers, not "pass everything through") — this
  // module's own `window: null` means the OPPOSITE ("no time filtering at
  // all"), so that helper is only invoked when a real window is given.
  const windowedSettlements = window ? filterRowsByDateWindow(inputs.settlements, (s) => s.week_ending, window) : inputs.settlements;
  const windowedDeductions = window ? filterRowsByDateWindow(inputs.deductions, (d) => d.ded_date, window) : inputs.deductions;
  const windowedFuel = window ? filterRowsByDateWindow(inputs.fuelPurchases, (f) => f.purchase_date, window) : inputs.fuelPurchases;
  const windowedMaintenance = window
    ? filterRowsByDateWindow(inputs.maintenanceRecords, (m) => m.service_date, window)
    : inputs.maintenanceRecords;
  const windowedTolls = window ? filterRowsByDateWindow(inputs.tolls, (t) => t.toll_date, window) : inputs.tolls;

  // NULL-TRUCK EXCLUSION FIX — the ONE scoping step every field below is
  // derived from. "All Trucks" (truckScope: null) matches everything, so
  // this is a no-op there; a real truckScope keeps that truck's own rows
  // PLUS every null-truck row (never a plain-equality exclusion).
  const settlements = windowedSettlements.filter((s) => matchesTruckScope(s.truck_id, truckScope));
  const deductions = windowedDeductions.filter((d) => matchesTruckScope(d.truck_id, truckScope));
  const fuelPurchases = windowedFuel.filter((f) => matchesTruckScope(f.truck_id, truckScope));
  const maintenanceRecords = windowedMaintenance.filter((m) => matchesTruckScope(m.truck_id, truckScope));
  const tolls = windowedTolls.filter((t) => matchesTruckScope(t.truck_id, truckScope));
  const settlementIds = new Set(settlements.map((s) => s.id));
  const filteredLoads = loads.filter((l) => l.settlement_id != null && settlementIds.has(l.settlement_id));

  const perDiemDays = calcPerDiemDays(
    settlements.filter((s): s is KpiSettlement & { week_ending: string } => s.week_ending != null)
  );

  // TRUE-PROFIT (this module's header comment) — gross minus every real
  // recorded dollar, one-offs INCLUDED. Identical formula for both
  // scopes; the only difference is which rows already passed the
  // truck-scope filter above.
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const trueExpenses = sumCanonicalExpenses(deductions, fuelPurchases, maintenanceRecords, tolls);
  const net = grossRevenue - trueExpenses;

  // Fixed cost basis: a scoped truck charges only ITS OWN weekly cost ×
  // its own (null-inclusive) settlement count; "All Trucks" sums every
  // real truck's own cost basis × its own settlement count (a null-truck
  // settlement contributes no truck payment to anyone — there's no truck
  // to charge it against).
  const carrierWithholdsLoan = carrierWithholdsLoanPayment(deductions);
  let fixedCostBasisTotal = 0;
  if (truckScope) {
    const truck = trucks.find((t) => t.id === truckScope);
    if (truck) {
      const truckOwnSettlementCount = windowedSettlements.filter((s) => s.truck_id === truckScope).length;
      fixedCostBasisTotal = calcTruckCostBasisWeekly(truck, carrierWithholdsLoan).weeklyFixedTotal * truckOwnSettlementCount;
    }
  } else {
    fixedCostBasisTotal = trucks.reduce((sum, tr) => {
      const count = windowedSettlements.filter((s) => s.truck_id === tr.id).length;
      return sum + calcTruckCostBasisWeekly(tr, carrierWithholdsLoan).weeklyFixedTotal * count;
    }, 0);
  }

  const milesResult = calcMiles(settlements, filteredLoads);
  const milesSource = resolveMilesTotal({ totalMiles: milesResult.totalMiles }, truckScope ? manualMilesOverride : undefined);

  const cpmResult = calcCanonicalCpm(
    grossRevenue,
    milesSource.totalMiles,
    deductions,
    fuelPurchases,
    maintenanceRecords,
    tolls,
    fixedCostBasisTotal
  );

  return {
    window,
    isAllTrucks: !truckScope,
    gross: grossRevenue,
    net,
    expenses: { total: trueExpenses, fixed: cpmResult.fixedTotal, variable: cpmResult.variableTotal },
    miles: {
      total: milesSource.totalMiles,
      loaded: milesResult.loadedMiles,
      empty: milesResult.emptyMiles,
      deadheadPct: milesResult.deadheadPct,
    },
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
