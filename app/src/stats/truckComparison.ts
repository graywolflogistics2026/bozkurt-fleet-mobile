// PER-TRUCK PROFITABILITY (MULTI-TRUCK MODEL, owner decision) —
// requirement 4: "the real reason someone runs three trucks... the screen
// that answers 'which truck should I keep?'" — revenue, expenses, net,
// CPM, RPM, profit/mile, miles, and deadhead % side by side per truck,
// ranked, best/worst highlighted. Reuses the SAME canonical primitives
// every other CPM/miles screen already reads from — calcMiles()
// (src/stats/miles.ts), calcCanonicalCpm()/carrierWithholdsLoanPayment()
// (src/stats/cpm.ts), calcTruckCostBasisWeekly() (src/stats/
// truckCostBasis.ts) — never a second CPM/miles formula.
import { calcMiles, type LoadMilesInput } from '@/src/stats/miles';
import { calcCanonicalCpm, carrierWithholdsLoanPayment, type CanonicalCpmResult } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly, type TruckCostBasisInput } from '@/src/stats/truckCostBasis';
import { allocateByMiles } from '@/src/stats/costAllocation';

// SELF-TEST FIX (owner decision, MULTI-TRUCK MODEL re-audit) — Home and
// Scorecard both used to compute their own headline CPM/RPM/PPM from
// FLEET-WIDE unfiltered data regardless of the active scope, then bolt
// only the scoped truck's own fixed cost basis on top — a broken hybrid
// (full-fleet revenue/variable-costs + one truck's fixed cost) that
// showed a worse-than-fleet-wide number, never that truck's real CPM.
// `ALLOCATED_BUCKET_CATEGORY`/`withAllocatedBucket()` let a screen show a
// DIRECT-only bucket breakdown (computed on that truck's own tagged
// rows, so each category still makes sense) while keeping the headline
// costPerMile/profitPerMile figure equal to the SAME direct+allocated
// total a `TruckComparisonRow` already reports — bucket-sum and headline
// can never drift apart, because this function is the only place either
// screen builds that combined view.
export const ALLOCATED_BUCKET_CATEGORY = 'Allocated Fleet Costs';

export function withAllocatedBucket(cpm: CanonicalCpmResult, allocatedAmount: number, totalMiles: number): CanonicalCpmResult {
  if (allocatedAmount <= 0) return cpm;
  const directTotal = cpm.buckets.reduce((sum, b) => sum + b.amount, 0);
  const buckets = [...cpm.buckets, { category: ALLOCATED_BUCKET_CATEGORY, amount: allocatedAmount, type: 'variable' as const }].sort(
    (a, b) => b.amount - a.amount
  );
  const variableTotal = cpm.variableTotal + allocatedAmount;
  const totalCost = directTotal + allocatedAmount;
  if (totalMiles <= 0) {
    return { ...cpm, buckets, variableTotal, costPerMile: null, profitPerMile: null, variableCostPerMile: null };
  }
  const costPerMile = totalCost / totalMiles;
  return {
    ...cpm,
    buckets,
    variableTotal,
    variableCostPerMile: variableTotal / totalMiles,
    costPerMile,
    profitPerMile: (cpm.revenuePerMile ?? 0) - costPerMile,
  };
}

export type ComparisonSettlement = {
  id: string;
  truck_id: string | null;
  week_ending: string | null;
  gross: number | null;
  net: number | null;
  miles: number | null;
};
export type ComparisonDeduction = {
  amount: number | null;
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
  description?: string | null;
  truck_id?: string | null;
};
export type ComparisonFuel = { amount: number | null; discount?: number | null; settlement_id?: string | null; truck_id?: string | null };
export type ComparisonMaintenance = { cost: number | null; truck_id?: string | null };
export type ComparisonToll = { amount: number | null; truck_id?: string | null };
export type ComparisonDriverPayment = { driver_id: string; settlement_id: string | null; gross_pay: number | null; employer_taxes: number | null };
export type ComparisonDriver = { id: string; default_truck_id: string | null; name: string };
export type ComparisonTruck = TruckCostBasisInput & { id: string; unit_number: string | null };

export type TruckComparisonRow = {
  truckId: string | null; // null = the synthetic "Unassigned" row
  unitNumber: string;
  isUnassigned: boolean;
  grossRevenue: number;
  directExpenses: number;
  // A per-truck share of fleet-level costs (deductions/fuel/maintenance/
  // tolls with no truck_id), split by miles — an ALLOCATION, never a
  // direct cost (requirement 6). Always 0 on the Unassigned row — see
  // module header comment.
  allocatedExpenses: number;
  totalExpenses: number;
  netProfit: number;
  totalMiles: number;
  loadedMiles: number;
  deadheadPct: number | null;
  revenuePerMile: number | null;
  costPerMile: number | null;
  profitPerMile: number | null;
  driverPay: number;
  netAfterDriverPay: number;
  settlementCount: number;
  // DIRECT-only bucket breakdown (this truck's own tagged deductions/
  // fuel/maintenance/tolls + its own cost basis, no fleet-level
  // allocation folded in) — a screen showing a per-category "Why?" table
  // for a single scoped truck should pass this through
  // withAllocatedBucket(row.cpmBreakdown, row.allocatedExpenses,
  // row.totalMiles) rather than recomputing calcCanonicalCpm() a second
  // time, which risks drifting from this row's own headline numbers.
  // null on the Unassigned row (no direct costs are ever attributed to
  // it — see allocation note above).
  cpmBreakdown: CanonicalCpmResult | null;
};

export type TruckComparisonResult = {
  // Real trucks only, ranked best-to-worst by netProfit.
  rows: TruckComparisonRow[];
  // Present only when at least one settlement has no truck_id — a
  // revenue-visibility flag, not a real "truck" (requirement 7's "a
  // null-truck row never disappears from a fleet view" — this is what
  // makes that true for THIS screen specifically). Always has 0 expenses
  // (see allocation note above) and is excluded from best/worst ranking.
  unassignedRow: TruckComparisonRow | null;
  bestTruckId: string | null;
  worstTruckId: string | null;
  // The whole account's totals, computed the same way a single
  // fleet-wide calcCanonicalCpm() call would (see the module's own test
  // file for the exact reconciliation proof) — always equals
  // sum(rows) + (unassignedRow's revenue only, its expenses are 0).
  fleetTotals: { grossRevenue: number; totalExpenses: number; netProfit: number; totalMiles: number };
};

function resolveDriverPaymentTruckId(
  payment: ComparisonDriverPayment,
  settlementsById: Map<string, ComparisonSettlement>,
  driversById: Map<string, ComparisonDriver>
): string | null {
  if (payment.settlement_id) {
    const s = settlementsById.get(payment.settlement_id);
    if (s?.truck_id) return s.truck_id;
  }
  const driver = driversById.get(payment.driver_id);
  return driver?.default_truck_id ?? null;
}

export function buildTruckComparison(
  trucks: ComparisonTruck[],
  settlements: ComparisonSettlement[],
  loads: LoadMilesInput[],
  deductions: ComparisonDeduction[],
  fuelPurchases: ComparisonFuel[],
  maintenanceRecords: ComparisonMaintenance[],
  tolls: ComparisonToll[],
  driverPayments: ComparisonDriverPayment[] = [],
  drivers: ComparisonDriver[] = []
): TruckComparisonResult {
  const carrierWithholdsLoan = carrierWithholdsLoanPayment(deductions);

  // Fleet-level cost pool (truck_id null on deductions/fuel/maintenance/
  // tolls) — reuses calcCanonicalCpm's own exclusion/double-count logic
  // (Meals/Advance Repayment/Escrow, standalone-fuel-only, ...) rather
  // than re-deriving it; grossRevenue=0/totalMiles=1 are dummy values,
  // only the resulting bucket totals matter.
  const fleetLevelDeductions = deductions.filter((d) => !d.truck_id);
  const fleetLevelFuel = fuelPurchases.filter((f) => !f.truck_id);
  const fleetLevelMaintenance = maintenanceRecords.filter((m) => !m.truck_id);
  const fleetLevelTolls = tolls.filter((t) => !t.truck_id);
  const fleetPool = calcCanonicalCpm(0, 1, fleetLevelDeductions, fleetLevelFuel, fleetLevelMaintenance, fleetLevelTolls, 0);
  const fleetPoolTotal = fleetPool.buckets.reduce((sum, b) => sum + b.amount, 0);

  const settlementsById = new Map(settlements.map((s) => [s.id, s]));
  const driversById = new Map(drivers.map((d) => [d.id, d]));
  const driverPayByTruck = new Map<string, number>();
  for (const p of driverPayments) {
    const truckId = resolveDriverPaymentTruckId(p, settlementsById, driversById);
    if (!truckId) continue;
    driverPayByTruck.set(truckId, (driverPayByTruck.get(truckId) ?? 0) + Number(p.gross_pay ?? 0) + Number(p.employer_taxes ?? 0));
  }

  // Pass 1: each real truck's own miles, for the allocation denominator.
  // Deliberately SUM OF REAL TRUCKS' OWN MILES, not the whole fleet's
  // (which would also include any unassigned settlement's miles) — this
  // is what guarantees allocated shares sum to exactly fleetPoolTotal
  // (see the module's test file), and it's the only meaningful
  // denominator anyway: a settlement with no truck_id has nothing to
  // allocate a fleet-level cost's SHARE against.
  const truckMiles = new Map<string, number>();
  for (const truck of trucks) {
    const truckSettlements = settlements.filter((s) => s.truck_id === truck.id);
    truckMiles.set(truck.id, calcMiles(truckSettlements, loads).totalMiles);
  }
  const realTruckTotalMiles = [...truckMiles.values()].reduce((sum, m) => sum + m, 0);

  function buildTruckRow(truck: ComparisonTruck): TruckComparisonRow {
    const truckSettlements = settlements.filter((s) => s.truck_id === truck.id);
    const milesResult = calcMiles(truckSettlements, loads);
    const grossRevenue = truckSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);

    const directDeductions = deductions.filter((d) => d.truck_id === truck.id);
    const directFuel = fuelPurchases.filter((f) => f.truck_id === truck.id);
    const directMaintenance = maintenanceRecords.filter((m) => m.truck_id === truck.id);
    const directTolls = tolls.filter((t) => t.truck_id === truck.id);

    const truckFixedCostTotal = calcTruckCostBasisWeekly(truck, carrierWithholdsLoan).weeklyFixedTotal * truckSettlements.length;

    const direct = calcCanonicalCpm(grossRevenue, milesResult.totalMiles, directDeductions, directFuel, directMaintenance, directTolls, truckFixedCostTotal);
    const directTotal = direct.buckets.reduce((sum, b) => sum + b.amount, 0);
    const allocatedExpenses = allocateByMiles(fleetPoolTotal, truckMiles.get(truck.id) ?? 0, realTruckTotalMiles);
    const totalExpenses = directTotal + allocatedExpenses;
    const netProfit = grossRevenue - totalExpenses;
    const driverPay = driverPayByTruck.get(truck.id) ?? 0;

    return {
      truckId: truck.id,
      unitNumber: truck.unit_number ?? truck.id,
      isUnassigned: false,
      grossRevenue,
      directExpenses: directTotal,
      allocatedExpenses,
      totalExpenses,
      netProfit,
      totalMiles: milesResult.totalMiles,
      loadedMiles: milesResult.loadedMiles,
      deadheadPct: milesResult.deadheadPct,
      revenuePerMile: milesResult.totalMiles > 0 ? grossRevenue / milesResult.totalMiles : null,
      costPerMile: milesResult.totalMiles > 0 ? totalExpenses / milesResult.totalMiles : null,
      profitPerMile: milesResult.totalMiles > 0 ? netProfit / milesResult.totalMiles : null,
      driverPay,
      netAfterDriverPay: netProfit - driverPay,
      settlementCount: truckSettlements.length,
      cpmBreakdown: direct,
    };
  }

  const rows = trucks.map(buildTruckRow).sort((a, b) => b.netProfit - a.netProfit);

  // UNASSIGNED (requirement 7: "a null-truck row never disappears from a
  // fleet view") — a settlement with no truck_id is real revenue that
  // must stay visible somewhere, not silently dropped because it can't be
  // attributed to a specific truck row. Its expenses are always 0: the
  // fleet-level cost pool it might otherwise seem to "own" is already
  // fully allocated to real trucks above (see realTruckTotalMiles's own
  // comment) — showing it again here would double-count it. This row's
  // netProfit is therefore just its gross revenue, a visibility flag
  // (and a nudge toward the truck-assignment repair screen), not a real
  // profitability figure — deliberately excluded from best/worst ranking.
  const unassignedSettlements = settlements.filter((s) => !s.truck_id);
  const unassignedRow: TruckComparisonRow | null =
    unassignedSettlements.length === 0
      ? null
      : {
          truckId: null,
          unitNumber: 'Unassigned',
          isUnassigned: true,
          grossRevenue: unassignedSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0),
          directExpenses: 0,
          allocatedExpenses: 0,
          totalExpenses: 0,
          netProfit: unassignedSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0),
          totalMiles: calcMiles(unassignedSettlements, loads).totalMiles,
          loadedMiles: calcMiles(unassignedSettlements, loads).loadedMiles,
          deadheadPct: calcMiles(unassignedSettlements, loads).deadheadPct,
          revenuePerMile: null,
          costPerMile: null,
          profitPerMile: null,
          driverPay: 0,
          netAfterDriverPay: unassignedSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0),
          settlementCount: unassignedSettlements.length,
          cpmBreakdown: null,
        };

  const bestTruckId = rows.length > 0 ? rows[0].truckId : null;
  const worstTruckId = rows.length > 0 ? rows[rows.length - 1].truckId : null;

  const grossRevenue = rows.reduce((sum, r) => sum + r.grossRevenue, 0) + (unassignedRow?.grossRevenue ?? 0);
  const totalExpenses = rows.reduce((sum, r) => sum + r.totalExpenses, 0);
  const fleetTotals = {
    grossRevenue,
    totalExpenses,
    netProfit: grossRevenue - totalExpenses,
    totalMiles: realTruckTotalMiles + (unassignedRow?.totalMiles ?? 0),
  };

  return { rows, unassignedRow, bestTruckId, worstTruckId, fleetTotals };
}
