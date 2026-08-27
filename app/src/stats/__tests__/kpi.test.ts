import { computeKpis } from '@/src/stats/kpi';
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
