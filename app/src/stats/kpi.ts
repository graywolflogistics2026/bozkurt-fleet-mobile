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
import {
  canonicalExpenseBreakdown,
  filterSettlementLinkedRowsToWindow,
  layeredGross,
  reducesTrueProfit,
  resolveFuelRows,
  splitSettlementLayers,
  type CanonicalReimbursement,
  type SettlementLayers,
} from '@/src/stats/trueProfit';
import { buildAuditLedger, type LedgerRow } from '@/src/stats/auditLedger';
import type { StatementExcludeReason } from '@/src/import/primeStatementLines';
import { settlementDeposit, settlementVerification, type SettlementStatement, type SettlementVerification } from '@/src/import/settlementStatement';
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
type KpiSettlement = ComparisonSettlement & { per_diem_days?: number | null; statement?: SettlementStatement | null };
type KpiDeduction = ComparisonDeduction & { ded_date?: string | null; settlement_id?: string | null };
type KpiFuel = ComparisonFuel & { purchase_date?: string | null; fuel_type?: string | null };
type KpiMaintenance = ComparisonMaintenance & { service_date?: string | null; settlement_id?: string | null };
type KpiToll = ComparisonToll & { toll_date?: string | null; settlement_id?: string | null };
// reimbursements carry no truck_id of their own — a settlement-linked one
// follows its settlement's truck and week; an unlinked one (a manual
// warranty credit) is a fleet-level row, matched by date only.
export type KpiReimbursement = CanonicalReimbursement & { settlement_id?: string | null; reimb_date?: string | null };

export type KpiInputs = {
  trucks: ComparisonTruck[];
  settlements: KpiSettlement[];
  loads: LoadMilesInput[];
  deductions: KpiDeduction[];
  fuelPurchases: KpiFuel[];
  maintenanceRecords: KpiMaintenance[];
  tolls: KpiToll[];
  // REQUIRED (golden settlement pass, owner decision 2026-10-13) —
  // reimbursements offset expenses; leaving them out understated profit
  // by every reimbursed dollar.
  reimbursements: KpiReimbursement[];
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
  reimbursementsTotal: number;
  // Statement-backed Prime weeks' expenses (already inside expenses.total).
  statementExpenses: number;
  // DEPOSITED (owner decision 2026-10-13): Σ each week's printed deposit
  // (else net due); owed-to-carrier weeks add 0 here and their amount to
  // owedToCarrier. Cash, never profit.
  deposits: number;
  owedToCarrier: number;
  // AUDIT LEDGER: every row behind expenses.total, with its status/reason.
  ledger: LedgerRow[];
  bridge: ProfitBridge;
};

// PROFIT BRIDGE (golden settlement pass, owner decision 2026-10-13) — how
// "This Week's Profit" follows from the settlements' printed net pay:
// net pay + every withheld line that is not an expense (advances,
// escrow/bond) − every expense that never passed through a settlement
// (out-of-pocket receipts, standalone fuel, maintenance, tolls) + every
// reimbursement not on a settlement = profit. Built from the SAME
// filtered rows computeKpis() uses, so it always lands on `net`.
// `difference` is whatever the saved rows do not explain (e.g. a
// settlement saved with lines missing) — shown, never hidden. The truck
// fixed-cost estimate is NOT part of profit (it feeds CPM/PPM only), so
// it is reported separately as information, never as a bridge line.
export type ProfitBridgeLine = { description: string; category: string | null; amount: number };
export type ProfitBridge = {
  // Net due of every week that is NOT statement-backed.
  netPay: number;
  // B2: the actual deposits of statement-backed Prime weeks.
  depositStart: number;
  nonExpenseLines: ProfitBridgeLine[];
  // Excluded statement lines, as the amount each adds back from deposit to
  // profit (advances, performance bond, ...).
  statementAddBacks: { label: string; reason: StatementExcludeReason; amount: number; weekEnding: string | null }[];
  // Interest income on statement-backed weeks — its own line (D8).
  interestIncome: number;
  outOfPocketDeductions: number;
  standaloneFuel: number;
  maintenance: number;
  tolls: number;
  reimbursementsNotOnSettlement: number;
  difference: number;
  profit: number;
  fixedCostEstimateInCpm: number;
  // Item 6: weeks whose line items differ from Prime's statement by > $1.
  crossChecks: { settlementId: string; weekEnding: string | null; lineExpenses: number; statementExpenses: number; difference: number }[];
  // Part 2: every week's source label.
  weeks: { settlementId: string; weekEnding: string | null; verification: SettlementVerification }[];
  // Any Unverified week in the window: profit is an estimate from line items.
  estimateFromLineItems: boolean;
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
  assertArray(inputs.reimbursements, 'reimbursements');

  const { trucks, loads, truckScope, manualMilesOverride, window } = inputs;

  // filterRowsByDateWindow returns [] for a null window (it's meant for
  // "no rows match" callers, not "pass everything through") — this
  // module's own `window: null` means the OPPOSITE ("no time filtering at
  // all"), so that helper is only invoked when a real window is given.
  const windowedSettlements = window ? filterRowsByDateWindow(inputs.settlements, (s) => s.week_ending, window) : inputs.settlements;
  const windowedDeductions = window ? filterRowsByDateWindow(inputs.deductions, (d) => d.ded_date, window) : inputs.deductions;
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
  const maintenanceRecords = windowedMaintenance.filter((m) => matchesTruckScope(m.truck_id, truckScope));
  const tolls = windowedTolls.filter((t) => matchesTruckScope(t.truck_id, truckScope));
  const settlementIds = new Set(settlements.map((s) => s.id));
  // Settlement-linked fuel/reimbursement rows follow their settlement's
  // week and truck (trueProfit.ts filterSettlementLinkedRowsToWindow());
  // standalone rows use their own date and, for fuel, their own truck_id.
  // With no window (all-time) an undated standalone row still counts.
  const inWindow = (d: string) => !window || (d >= window.startIso && d <= window.endIso);
  const undatedPasses = !window;
  const fuelPurchases = filterSettlementLinkedRowsToWindow(
    inputs.fuelPurchases,
    (f) => f.purchase_date ?? (undatedPasses ? '' : null),
    settlementIds,
    inWindow
  ).filter((f) => !!f.settlement_id || matchesTruckScope(f.truck_id, truckScope));
  const reimbursements = filterSettlementLinkedRowsToWindow(
    inputs.reimbursements,
    (r) => r.reimb_date ?? (undatedPasses ? '' : null),
    settlementIds,
    inWindow
  );
  const filteredLoads = loads.filter((l) => l.settlement_id != null && settlementIds.has(l.settlement_id));

  const perDiemDays = calcPerDiemDays(
    settlements.filter((s): s is KpiSettlement & { week_ending: string } => s.week_ending != null)
  );

  // TRUE-PROFIT (this module's header comment) — gross minus every real
  // recorded dollar, one-offs INCLUDED. TWO SETTLEMENT LAYERS (owner
  // decision 2026-10-13): a statement-backed Prime week counts from
  // Prime's own Statement of Income and Expense and its linked rows are
  // removed here (detail only); every other row goes through the
  // line-level engine. Identical formula for both scopes.
  const layers = splitSettlementLayers(settlements, deductions, fuelPurchases, maintenanceRecords, tolls, reimbursements);
  const grossRevenue = layeredGross(settlements);
  const lineBreakdown = canonicalExpenseBreakdown(
    layers.deductions,
    layers.fuelPurchases,
    layers.maintenanceRecords,
    layers.tolls,
    layers.reimbursements
  );
  const statementExpenses = layers.statementWeeks.reduce((sum, w) => sum + w.expenses, 0);
  const trueExpenses = lineBreakdown.total + statementExpenses;
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
    layers.deductions,
    layers.fuelPurchases,
    layers.maintenanceRecords,
    layers.tolls,
    layers.reimbursements,
    layers.statementWeeks,
    fixedCostBasisTotal
  );

  // DEPOSITED (owner decision 2026-10-13) — a sum of each week's PRINTED
  // deposit (else net due); an owed-to-carrier week adds 0. Never a
  // running balance.
  const weekDeposits = settlements.map((s) => ({ s, d: settlementDeposit(s) }));
  const deposits = weekDeposits.reduce((sum, x) => sum + x.d.deposited, 0);
  const owedToCarrier = weekDeposits.reduce((sum, x) => sum + x.d.owedToCarrier, 0);

  const ledger = buildAuditLedger(
    layers.statementWeeks,
    layers.deductions,
    layers.fuelPurchases,
    layers.maintenanceRecords,
    layers.tolls,
    layers.reimbursements
  );

  const bridge = buildProfitBridge({
    settlements,
    layers,
    allLinked: { deductions, fuelPurchases, maintenanceRecords, tolls, reimbursements },
    profit: net,
    fixedCostEstimateInCpm: fixedCostBasisTotal,
  });

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
    reimbursementsTotal: lineBreakdown.reimbursementsTotal,
    statementExpenses,
    deposits,
    owedToCarrier,
    ledger,
    bridge,
  };
}

function buildProfitBridge(args: {
  settlements: KpiSettlement[];
  layers: SettlementLayers<KpiDeduction, KpiFuel, KpiMaintenance, KpiToll, KpiReimbursement>;
  allLinked: {
    deductions: KpiDeduction[];
    fuelPurchases: KpiFuel[];
    maintenanceRecords: KpiMaintenance[];
    tolls: KpiToll[];
    reimbursements: KpiReimbursement[];
  };
  profit: number;
  fixedCostEstimateInCpm: number;
}): ProfitBridge {
  const { settlements, layers, allLinked, profit, fixedCostEstimateInCpm } = args;
  const { deductions, fuelPurchases, maintenanceRecords, tolls, reimbursements } = layers;
  const backed = layers.backedSettlementIds;

  // B2: a statement-backed week starts from the actual deposit; every
  // other week from its net due, as before.
  const netPay = settlements.filter((s) => !backed.has(s.id)).reduce((sum, s) => sum + Number(s.net ?? 0), 0);
  const depositStart = layers.statementWeeks.reduce((sum, w) => sum + w.deposit, 0);
  const statementAddBacks = layers.statementWeeks.flatMap((w) => w.addBacks.map((a) => ({ ...a, weekEnding: w.weekEnding })));
  const interestIncome = layers.statementWeeks.reduce((sum, w) => sum + w.interestIncome, 0);

  // A withheld line already sits inside its settlement's net pay; the ones
  // that do not reduce profit are added back.
  const withheld = (d: KpiDeduction) => d.source === 'settlement' && !!d.settlement_id;
  const nonExpenseLines: ProfitBridgeLine[] = deductions
    .filter((d) => withheld(d) && !reducesTrueProfit(d) && Number(d.amount ?? 0) !== 0)
    .map((d) => ({ description: d.description ?? d.category ?? '', category: d.category ?? null, amount: Number(d.amount ?? 0) }));
  const outOfPocketDeductions = deductions
    .filter((d) => !withheld(d) && reducesTrueProfit(d))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const standaloneFuel = resolveFuelRows(fuelPurchases, deductions)
    .counted.filter((r) => !r.row.settlement_id)
    .reduce((sum, r) => sum + r.cost, 0);
  const maintenance = maintenanceRecords.filter((m) => !m.settlement_id).reduce((sum, m) => sum + Number(m.cost ?? 0), 0);
  const tollsTotal = tolls.filter((t) => !t.settlement_id).reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  const reimbursementsNotOnSettlement = reimbursements.filter((r) => !r.settlement_id).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const explained =
    netPay +
    depositStart +
    nonExpenseLines.reduce((sum, l) => sum + l.amount, 0) +
    statementAddBacks.reduce((sum, a) => sum + a.amount, 0) -
    interestIncome -
    outOfPocketDeductions -
    standaloneFuel -
    maintenance -
    tollsTotal +
    reimbursementsNotOnSettlement;
  const difference = Math.round((profit - explained) * 100) / 100;

  // CROSS-CHECK (item 6): the week's own line items, counted the line way,
  // vs Prime's statement. Profit stays the statement's.
  const crossChecks = layers.statementWeeks
    .map((w) => {
      const linked = <R extends { settlement_id?: string | null }>(rows: R[]) => rows.filter((r) => r.settlement_id === w.settlementId);
      const lineExpenses = canonicalExpenseBreakdown(
        linked(allLinked.deductions),
        linked(allLinked.fuelPurchases),
        linked(allLinked.maintenanceRecords),
        linked(allLinked.tolls),
        linked(allLinked.reimbursements)
      ).total;
      return { settlementId: w.settlementId, weekEnding: w.weekEnding, lineExpenses, statementExpenses: w.expenses, difference: Math.round((lineExpenses - w.expenses) * 100) / 100 };
    })
    .filter((c) => Math.abs(c.difference) > 1);

  const weeks = settlements.map((s) => ({ settlementId: s.id, weekEnding: s.week_ending, verification: settlementVerification(s) }));

  return {
    netPay,
    depositStart,
    nonExpenseLines,
    statementAddBacks,
    interestIncome,
    outOfPocketDeductions,
    standaloneFuel,
    maintenance,
    tolls: tollsTotal,
    reimbursementsNotOnSettlement,
    difference: difference === 0 ? 0 : difference,
    profit,
    fixedCostEstimateInCpm,
    crossChecks,
    weeks,
    estimateFromLineItems: weeks.some((w) => w.verification === 'unverified'),
  };
}
