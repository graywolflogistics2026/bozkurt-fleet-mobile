// CPM/PPM BROKEN AGAIN — ROOT CAUSE FIX (owner decision, device report):
// the ONE shared orchestration every period-aware CPM display (currently
// Home's per-mile trio + its own "Why?" breakdown) reads from — resolves
// the Hero Card's selected period to a concrete date window
// (src/stats/heroPeriodWindow.ts), filters EVERY input row array
// (settlements/loads/deductions/fuel/maintenance/tolls) through that SAME
// window before any of them reach buildTruckComparison(), and derives
// the truck-scoped-or-fleet-wide CPM the exact same way scorecard.tsx's
// own (deliberately all-time, unwindowed) fix already established —
// never a second, screen-local recomputation. Because numerator (every
// cost/revenue row) and denominator (miles, via calcMiles over the SAME
// filtered settlements+loads) are filtered through the identical
// function call with the identical window, they cannot drift onto
// different date ranges from each other.
import { calcMiles, resolveMilesTotal } from '@/src/stats/miles';
import { calcCanonicalCpm, carrierWithholdsLoanPayment, type CanonicalCpmResult } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly } from '@/src/stats/truckCostBasis';
import {
  buildTruckComparison,
  withAllocatedBucket,
  type ComparisonTruck,
  type ComparisonSettlement,
  type ComparisonDeduction,
  type ComparisonFuel,
  type ComparisonMaintenance,
  type ComparisonToll,
  type TruckComparisonResult,
  type TruckComparisonRow,
} from '@/src/stats/truckComparison';
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
    return { window: null, comparison, scopedRow, cpm: null };
  }

  if (scopedRow) {
    if (!scopedRow.cpmBreakdown) return { window, comparison, scopedRow, cpm: null };
    const milesSource = resolveMilesTotal({ totalMiles: scopedRow.totalMiles }, manualMilesOverride);
    const withAlloc = withAllocatedBucket(scopedRow.cpmBreakdown, scopedRow.allocatedExpenses, milesSource.totalMiles);
    const revenuePerMile = milesSource.totalMiles > 0 ? scopedRow.grossRevenue / milesSource.totalMiles : null;
    const profitPerMile = revenuePerMile != null && withAlloc.costPerMile != null ? revenuePerMile - withAlloc.costPerMile : null;
    return { window, comparison, scopedRow, cpm: { ...withAlloc, revenuePerMile, profitPerMile } };
  }

  // "All Trucks" scope — same fleet-wide calcCanonicalCpm() shape every
  // prior pass established, now fed WINDOW-filtered rows instead of
  // all-time ones, with the fixed-cost total naturally pro-rated to the
  // window (each truck's own weekly cost basis × its own settlement
  // count WITHIN this window — a month-long window naturally sums ~4
  // settlement weeks per truck, a single week sums 1, never a
  // multi-week total charged against one week's miles).
  const carrierWithholdsLoan = carrierWithholdsLoanPayment(fDeductions);
  const fleetFixedCostTotal = trucks.reduce((sum, tr) => {
    const count = fSettlements.filter((s) => s.truck_id === tr.id).length;
    return sum + calcTruckCostBasisWeekly(tr, carrierWithholdsLoan).weeklyFixedTotal * count;
  }, 0);
  const grossRevenue = fSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const totalMiles = calcMiles(fSettlements, fLoads).totalMiles;
  if (totalMiles <= 0) {
    return {
      window,
      comparison,
      scopedRow: null,
      cpm: calcCanonicalCpm(grossRevenue, 0, fDeductions, fFuel, fMaintenance, fTolls, fleetFixedCostTotal),
    };
  }
  return {
    window,
    comparison,
    scopedRow: null,
    cpm: calcCanonicalCpm(grossRevenue, totalMiles, fDeductions, fFuel, fMaintenance, fTolls, fleetFixedCostTotal),
  };
}
