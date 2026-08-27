import { computeKpis, matchesTruckScope } from '@/src/stats/kpi';
import { calcMiles } from '@/src/stats/miles';
import type { ComparisonTruck } from '@/src/stats/truckComparison';

const truckA: ComparisonTruck = {
  id: 'ta',
  unit_number: '100',
  cost_basis_ownership_mode: null,
  purchase_price: null,
  cost_basis_loan_monthly_payment: null,
  cost_basis_paid_spread_months: null,
  cost_basis_warranty_cost: null,
  cost_basis_warranty_term_months: null,
};
const truckB: ComparisonTruck = { ...truckA, id: 'tb', unit_number: '200' };

const settlements = [
  { id: 's1', truck_id: 'ta', week_ending: '2026-08-01', gross: 2000, net: 1800, miles: 1000, per_diem_days: 7 },
  { id: 's2', truck_id: 'ta', week_ending: '2026-08-08', gross: 2200, net: 2000, miles: 1000, per_diem_days: 7 },
  { id: 's3', truck_id: 'tb', week_ending: '2026-08-08', gross: 1500, net: 1400, miles: 800, per_diem_days: 7 },
];

const deductions = [
  { amount: 200, source: 'manual', category: 'Maintenance & Repairs', tax_deductible: true, truck_id: 'ta', ded_date: '2026-08-01' },
  { amount: 150, source: 'manual', category: 'Fuel & DEF', tax_deductible: true, truck_id: 'tb', ded_date: '2026-08-08' },
];

describe('computeKpis — KPI CONSISTENCY (owner decision)', () => {
  it('a scoped truck: gross/net/miles/rpm/cpm/ppm are internally consistent and match the truck\'s own settlements only', () => {
    const result = computeKpis({
      trucks: [truckA, truckB],
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    expect(result.gross).toBe(4200); // s1 + s2, truck B excluded
    expect(result.miles.total).toBe(2000);
    expect(result.expenses.total).toBe(200); // only truck A's own $200 maintenance deduction
    expect(result.net).toBe(4200 - 200);
    expect(result.rpm).toBeCloseTo(4200 / 2000, 5);
    expect(result.cpm).toBeCloseTo(200 / 2000, 5);
    // PPM must equal RPM - CPM BY CONSTRUCTION — this is the literal fix
    // for "Net/Mile doesn't equal RPM - CPM" (device report).
    expect(result.ppm).toBeCloseTo(result.rpm! - result.cpm!, 8);
    expect(result.perDiemDays).toBe(14); // 2 distinct weeks x 7
  });

  it('"All Trucks" scope (truckScope: null) reconciles to the whole fleet, matching fleetTotals via buildTruckComparison', () => {
    const result = computeKpis({
      trucks: [truckA, truckB],
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: null,
      window: null,
    });
    expect(result.gross).toBe(2000 + 2200 + 1500);
    expect(result.expenses.total).toBe(350); // 200 + 150
    expect(result.net).toBe(2000 + 2200 + 1500 - 350);
    expect(result.miles.total).toBe(1000 + 1000 + 800);
    expect(result.ppm).toBeCloseTo(result.rpm! - result.cpm!, 8);
  });

  it('window: null means NO time filtering at all (every row passed in counts, regardless of date)', () => {
    const withNull = computeKpis({
      trucks: [truckA],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: deductions.filter((d) => d.truck_id === 'ta'),
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    expect(withNull.gross).toBe(4200);
  });

  it('a real window filters settlements AND deductions identically — numerator and denominator never drift onto different date ranges', () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: deductions.filter((d) => d.truck_id === 'ta'),
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: { startIso: '2026-08-01', endIso: '2026-08-01' }, // only s1's own week
    });
    expect(result.gross).toBe(2000);
    expect(result.miles.total).toBe(1000);
    expect(result.expenses.total).toBe(200); // s1's own deduction only
    expect(result.settlementCount).toBe(1);
  });

  it('KPI CONSISTENCY FIX — a major one-off repair logged as a maintenance_records row (not a deduction) is excluded from CPM, same as one logged as a deduction', () => {
    const withOneOff = computeKpis({
      trucks: [truckA],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [
        { cost: 400, truck_id: 'ta', description: 'Oil change', service_type: 'oil', service_date: '2026-08-01' },
        { cost: 18000, truck_id: 'ta', description: 'Engine overhaul', service_type: 'engine', service_date: '2026-08-08' },
      ],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    // Only the $400 oil change counts toward the PER-MILE CPM figure —
    // the $18,000 engine overhaul is a one-off, excluded from CPM
    // specifically, and reported separately in excludedOneOffs.
    expect(withOneOff.excludedOneOffs).toHaveLength(1);
    expect(withOneOff.excludedOneOffs[0]).toMatchObject({ amount: 18000, reason: 'major_repair_overhaul' });
    expect(withOneOff.cpm).toBeCloseTo(400 / 2000, 5);
    // The $18,000 is still a REAL expense that really happened — it must
    // still reduce true NET PROFIT (expenses.total), never silently
    // vanish from the whole-dollar P&L just because it's excluded from
    // the narrower per-mile ratio.
    expect(withOneOff.expenses.total).toBe(400 + 18000);
    expect(withOneOff.net).toBe(4200 - 400 - 18000);
  });

  it('a scoped truck with no settlements at all returns zeros/nulls, never throws', () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: [],
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    expect(result.gross).toBe(0);
    expect(result.miles.total).toBe(0);
    expect(result.rpm).toBeNull();
    expect(result.cpm).toBeNull();
    expect(result.ppm).toBeNull();
  });

  it('a manual miles override changes rpm/cpm/ppm together, consistently (never a stale revenuePerMile baked in before the override)', () => {
    const withoutOverride = computeKpis({
      trucks: [truckA],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: deductions.filter((d) => d.truck_id === 'ta'),
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    const withOverride = computeKpis({
      trucks: [truckA],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: deductions.filter((d) => d.truck_id === 'ta'),
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      manualMilesOverride: 3000, // an odometer reading larger than the settlement-derived 2000
      window: null,
    });
    expect(withOverride.miles.total).toBe(3000);
    expect(withOverride.rpm).toBeCloseTo(4200 / 3000, 5);
    expect(withOverride.cpm).toBeCloseTo(200 / 3000, 5);
    expect(withOverride.ppm).toBeCloseTo(withOverride.rpm! - withOverride.cpm!, 8);
    expect(withOverride.rpm).not.toBeCloseTo(withoutOverride.rpm!, 3);
  });
});

// NULL-TRUCK EXCLUSION FIX (owner decision, device report: "the new KPI
// engine is dropping most of my data" — expenses reading $0, Scorecard
// miles reading ~30% of the real total, Weekly Net Trend showing 2 of 6
// weeks). Reproduces the exact bug class and proves the fix — the same
// four regression guards the report explicitly asked for.
describe('computeKpis — NULL-TRUCK EXCLUSION FIX (owner decision)', () => {
  // A realistic single-truck-shaped account: 6 settlements, 4 of which
  // predate/never got a truck_id assigned (truck_id: null) — the common
  // real-world shape (single-truck accounts always have a real,
  // non-null activeTruck scope, ActiveTruckContext's own n=1 shortcut,
  // so EVERY null-truck row was previously invisible the instant a
  // truck was scoped).
  const sixSettlements = [
    { id: 's1', truck_id: null, week_ending: '2026-07-17', gross: 1600, net: 1500, miles: 1500, per_diem_days: 7 },
    { id: 's2', truck_id: null, week_ending: '2026-07-24', gross: 1700, net: 1600, miles: 1600, per_diem_days: 7 },
    { id: 's3', truck_id: 'ta', week_ending: '2026-07-31', gross: 1800, net: 1700, miles: 1700, per_diem_days: 7 },
    { id: 's4', truck_id: null, week_ending: '2026-08-07', gross: 1900, net: 1800, miles: 1800, per_diem_days: 7 },
    { id: 's5', truck_id: null, week_ending: '2026-08-14', gross: 2000, net: 1900, miles: 1900, per_diem_days: 7 },
    { id: 's6', truck_id: 'ta', week_ending: '2026-08-26', gross: 2100, net: 2000, miles: 2000, per_diem_days: 7 },
  ];
  const fleetMilesTruth = sixSettlements.reduce((sum, s) => sum + s.miles, 0); // 10,500

  it("REGRESSION GUARD 1 — the fleet view's (truckScope: null) miles equal the sum of every settlement's miles, no exclusion", () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements,
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: null,
      window: null,
    });
    expect(result.miles.total).toBe(fleetMilesTruth);
    expect(result.settlementCount).toBe(6);
  });

  it('REGRESSION GUARD — a SCOPED truck ALSO sees every null-truck settlement (never silently dropped), matching the single-truck-account real-world shape', () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements,
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    // The literal reported symptom: miles must equal the real fleet
    // total (10,500), never a fraction of it (the bug produced ~30%).
    expect(result.miles.total).toBe(fleetMilesTruth);
    expect(result.settlementCount).toBe(6);
  });

  it('REGRESSION GUARD 2 — NULL-truck expense rows (deductions, fuel, maintenance, tolls) are included in BOTH the fleet view and a specific truck\'s own scoped view', () => {
    const nullTruckDeduction = { amount: 300, source: 'manual', category: 'Insurance—Truck', tax_deductible: true, truck_id: null, ded_date: '2026-08-07' };
    const nullTruckFuel = { amount: 500, discount: 0, settlement_id: null, truck_id: null, purchase_date: '2026-08-07' };
    const nullTruckMaintenance = { cost: 250, truck_id: null, service_date: '2026-08-07' };
    const nullTruckToll = { amount: 40, truck_id: null, toll_date: '2026-08-07' };

    const fleetView = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements,
      loads: [],
      deductions: [nullTruckDeduction],
      fuelPurchases: [nullTruckFuel],
      maintenanceRecords: [nullTruckMaintenance],
      tolls: [nullTruckToll],
      truckScope: null,
      window: null,
    });
    expect(fleetView.expenses.total).toBe(300 + 500 + 250 + 40);

    const scopedView = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements,
      loads: [],
      deductions: [nullTruckDeduction],
      fuelPurchases: [nullTruckFuel],
      maintenanceRecords: [nullTruckMaintenance],
      tolls: [nullTruckToll],
      truckScope: 'ta',
      window: null,
    });
    // THE LITERAL REPORTED BUG — "Expenses show $0" — a scoped truck must
    // still see every null-truck expense row, never $0 just because
    // truck_id doesn't strictly equal truckScope.
    expect(scopedView.expenses.total).toBe(300 + 500 + 250 + 40);
  });

  it('REGRESSION GUARD 3 — matchesTruckScope() lists every settlement week in the period, none missing, for the same shape the Weekly Net Trend list reads', () => {
    // Mirrors scorecard.tsx's own scopedSettlements filter exactly.
    const scoped = sixSettlements.filter((s) => matchesTruckScope(s.truck_id, 'ta'));
    const weekEndings = [...new Set(scoped.map((s) => s.week_ending))].sort();
    expect(weekEndings).toEqual(['2026-07-17', '2026-07-24', '2026-07-31', '2026-08-07', '2026-08-14', '2026-08-26']);
    expect(scoped).toHaveLength(6); // never "2 of 6"
  });

  it('REGRESSION GUARD 4 — expenses are non-zero when expense rows exist, for a scoped truck whose expenses are ENTIRELY null-truck rows (fuel specifically, matching the device report\'s own emphasis)', () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements.filter((s) => s.truck_id === 'ta'),
      loads: [],
      deductions: [],
      fuelPurchases: [
        { amount: 800, discount: 50, settlement_id: null, truck_id: null, purchase_date: '2026-07-31' },
        { amount: 900, discount: 0, settlement_id: null, truck_id: null, purchase_date: '2026-08-26' },
      ],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    expect(result.expenses.total).toBe(800 - 50 + 900);
    expect(result.expenses.total).toBeGreaterThan(0);
  });

  it("REGRESSION GUARD 5 — the KPI engine's totals match the raw table sums (calcMiles(), plain gross sum) for the same window/scope", () => {
    const result = computeKpis({
      trucks: [truckA],
      settlements: sixSettlements,
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    const rawMiles = calcMiles(sixSettlements, []);
    const rawGross = sixSettlements.reduce((sum, s) => sum + s.gross, 0);
    expect(result.miles.total).toBe(rawMiles.totalMiles);
    expect(result.gross).toBe(rawGross);
  });
});

// EXPENSES READING $0 / SILENT-ZERO GUARD (owner decision, device report:
// "the entire expense side is empty... an optional parameter that
// defaults to [] would produce exactly this... a zero expense figure in
// accounting software is never an acceptable silent default").
describe('computeKpis — missing-source guard (owner decision)', () => {
  const validArgs = {
    trucks: [truckA],
    settlements,
    loads: [],
    deductions,
    fuelPurchases: [],
    maintenanceRecords: [],
    tolls: [],
    truckScope: 'ta' as string | null,
    window: null,
  };

  it('real fuel/maintenance/toll/deduction rows all reach the engine and sum exactly, not silently zeroed', () => {
    const result = computeKpis({
      ...validArgs,
      deductions: [{ amount: 111, source: 'manual', category: 'Fuel & DEF', tax_deductible: true, truck_id: 'ta', ded_date: '2026-08-01' }],
      fuelPurchases: [{ amount: 222, discount: 0, settlement_id: null, truck_id: 'ta', purchase_date: '2026-08-01' }],
      maintenanceRecords: [{ cost: 333, truck_id: 'ta', service_date: '2026-08-01' }],
      tolls: [{ amount: 44, truck_id: 'ta', toll_date: '2026-08-01' }],
      settlements: settlements.filter((s) => s.truck_id === 'ta'),
    });
    expect(result.expenses.total).toBe(111 + 222 + 333 + 44);
  });

  it('throws (never silently returns $0) when deductions is undefined instead of []', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeKpis({ ...validArgs, deductions: undefined as any })).toThrow(/deductions.*must be an array/i);
  });

  it('throws when fuelPurchases is undefined instead of []', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeKpis({ ...validArgs, fuelPurchases: undefined as any })).toThrow(/fuelPurchases.*must be an array/i);
  });

  it('throws when maintenanceRecords is undefined instead of []', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeKpis({ ...validArgs, maintenanceRecords: undefined as any })).toThrow(/maintenanceRecords.*must be an array/i);
  });

  it('throws when tolls is undefined instead of []', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeKpis({ ...validArgs, tolls: undefined as any })).toThrow(/tolls.*must be an array/i);
  });

  it('throws when settlements is undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeKpis({ ...validArgs, settlements: undefined as any })).toThrow(/settlements.*must be an array/i);
  });

  it('throws when a query RESULT OBJECT ({ data: [...] }) is passed instead of the plain array — the exact "wrong shape" case named in the report', () => {
    const wrongShape = { data: deductions, isLoading: false } as unknown as typeof deductions;
    expect(() => computeKpis({ ...validArgs, deductions: wrongShape })).toThrow(/deductions.*must be an array/i);
  });
});
