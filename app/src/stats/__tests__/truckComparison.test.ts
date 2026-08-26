import { buildTruckComparison, type ComparisonDeduction, type ComparisonSettlement, type ComparisonTruck } from '@/src/stats/truckComparison';
import { calcCanonicalCpm } from '@/src/stats/cpm';

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

const settlements: ComparisonSettlement[] = [
  { id: 's1', truck_id: 'ta', week_ending: '2026-01-01', gross: 5000, net: 4500, miles: 2000 },
  { id: 's2', truck_id: 'tb', week_ending: '2026-01-01', gross: 3000, net: 2800, miles: 1000 },
  // No truck_id — this is the "settlement that vanished from Home" bug
  // this feature exists to eliminate (CLAUDE.md's MULTI-TRUCK MODEL
  // entry's own diagnosed example).
  { id: 's3', truck_id: null, week_ending: '2026-01-08', gross: 800, net: 750, miles: 200 },
];

const deductions: ComparisonDeduction[] = [
  { amount: 500, category: 'Maintenance & Repairs', tax_deductible: true, source: 'manual', truck_id: 'ta' },
  { amount: 200, category: 'Maintenance & Repairs', tax_deductible: true, source: 'manual', truck_id: 'tb' },
  // Fleet-level (no truck_id) — insurance billed for the whole fleet,
  // exactly requirement 6's own example.
  { amount: 1000, category: 'Insurance—Truck', tax_deductible: true, source: 'manual', truck_id: null },
  // Fleet-level but excluded from CPM entirely (per diem already covers
  // it) — proves the allocation pool reuses calcCanonicalCpm's own
  // exclusion rules rather than summing every null-truck row blindly.
  { amount: 100, category: 'Meals (per diem covered)', tax_deductible: true, source: 'manual', truck_id: null },
];

describe('buildTruckComparison', () => {
  it('a null-truck settlement never disappears — it surfaces as its own Unassigned row', () => {
    const result = buildTruckComparison(
      [truckA, truckB],
      settlements,
      [],
      deductions,
      [],
      [],
      []
    );
    expect(result.unassignedRow).not.toBeNull();
    expect(result.unassignedRow!.grossRevenue).toBe(800);
    expect(result.unassignedRow!.isUnassigned).toBe(true);
    // Not attributed to either truck.
    expect(result.rows.find((r) => r.truckId === 'ta')!.grossRevenue).toBe(5000);
    expect(result.rows.find((r) => r.truckId === 'tb')!.grossRevenue).toBe(3000);
  });

  it('omits the Unassigned row entirely when every settlement has a truck_id', () => {
    const assigned = settlements.filter((s) => s.truck_id);
    const result = buildTruckComparison([truckA, truckB], assigned, [], deductions, [], [], []);
    expect(result.unassignedRow).toBeNull();
  });

  it('per-truck CPM uses only that truck\'s own direct costs plus its allocated share of fleet-level costs', () => {
    const result = buildTruckComparison([truckA, truckB], settlements, [], deductions, [], [], []);
    const a = result.rows.find((r) => r.truckId === 'ta')!;
    const b = result.rows.find((r) => r.truckId === 'tb')!;

    // Direct: truck A's own $500 Maintenance row only — never truck B's
    // $200 row.
    expect(a.directExpenses).toBeCloseTo(500, 5);
    expect(b.directExpenses).toBeCloseTo(200, 5);

    // Allocated: the $1000 fleet-level Insurance pool (Meals excluded)
    // split by each truck's OWN miles share of the two trucks' combined
    // 3000 miles (2000 + 1000) — never the whole fleet's miles, which
    // would also include the unassigned settlement's 200.
    expect(a.allocatedExpenses).toBeCloseTo(1000 * (2000 / 3000), 5);
    expect(b.allocatedExpenses).toBeCloseTo(1000 * (1000 / 3000), 5);
    expect(a.allocatedExpenses + b.allocatedExpenses).toBeCloseTo(1000, 5);

    expect(a.totalExpenses).toBeCloseTo(a.directExpenses + a.allocatedExpenses, 5);
    expect(a.netProfit).toBeCloseTo(a.grossRevenue - a.totalExpenses, 5);
  });

  it('ranks trucks best-to-worst by net profit and flags best/worst', () => {
    const result = buildTruckComparison([truckA, truckB], settlements, [], deductions, [], [], []);
    expect(result.rows[0].truckId).toBe('ta'); // higher revenue, proportionally lower allocated cost
    expect(result.bestTruckId).toBe('ta');
    expect(result.worstTruckId).toBe('tb');
  });

  it("the comparison view's totals reconcile with a single whole-fleet canonical CPM run", () => {
    const result = buildTruckComparison([truckA, truckB], settlements, [], deductions, [], [], []);

    const wholeFleet = calcCanonicalCpm(
      settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0),
      9999, // totalMiles is irrelevant to the total-cost figure being checked
      deductions,
      [],
      [],
      [],
      0
    );
    const wholeFleetTotalCost = wholeFleet.buckets.reduce((sum, b) => sum + b.amount, 0);

    expect(result.fleetTotals.totalExpenses).toBeCloseTo(wholeFleetTotalCost, 5);
    expect(result.fleetTotals.grossRevenue).toBe(5000 + 3000 + 800);
    expect(result.fleetTotals.netProfit).toBeCloseTo(result.fleetTotals.grossRevenue - result.fleetTotals.totalExpenses, 5);

    // And the sum of the individual truck rows (+ Unassigned's revenue,
    // which carries no expenses of its own — see module header) must
    // equal those same fleet totals.
    const rowsGross = result.rows.reduce((sum, r) => sum + r.grossRevenue, 0) + (result.unassignedRow?.grossRevenue ?? 0);
    const rowsExpenses = result.rows.reduce((sum, r) => sum + r.totalExpenses, 0);
    expect(rowsGross).toBe(result.fleetTotals.grossRevenue);
    expect(rowsExpenses).toBeCloseTo(result.fleetTotals.totalExpenses, 5);
  });

  it('includes each truck\'s own cost basis (weekly fixed cost) as a direct cost, never blended with another truck\'s', () => {
    const configuredA: ComparisonTruck = {
      ...truckA,
      cost_basis_ownership_mode: 'paid',
      purchase_price: 52000,
      cost_basis_paid_spread_months: 52, // -> $1000/month -> ~$230.77/week
    };
    const result = buildTruckComparison([configuredA, truckB], settlements, [], [], [], [], []);
    const a = result.rows.find((r) => r.truckId === 'ta')!;
    const b = result.rows.find((r) => r.truckId === 'tb')!;
    expect(a.directExpenses).toBeGreaterThan(0);
    expect(b.directExpenses).toBe(0); // truckB has no cost basis configured
  });

  it('driver pay reduces net-after-driver-pay per truck without touching net profit', () => {
    const result = buildTruckComparison(
      [truckA, truckB],
      settlements,
      [],
      deductions,
      [],
      [],
      [],
      [{ driver_id: 'd1', settlement_id: 's1', gross_pay: 1200, employer_taxes: 100 }],
      [{ id: 'd1', default_truck_id: 'ta', name: 'Driver One' }]
    );
    const a = result.rows.find((r) => r.truckId === 'ta')!;
    expect(a.driverPay).toBe(1300);
    expect(a.netAfterDriverPay).toBeCloseTo(a.netProfit - 1300, 5);
    // netProfit itself is unaffected by driver pay (it's a margin-after
    // view, not folded into the expense total).
    expect(a.netProfit).toBeCloseTo(a.grossRevenue - a.totalExpenses, 5);
  });

  it('falls back to a driver\'s default_truck_id when a payment has no settlement_id', () => {
    const result = buildTruckComparison(
      [truckA, truckB],
      settlements,
      [],
      deductions,
      [],
      [],
      [],
      [{ driver_id: 'd2', settlement_id: null, gross_pay: 500, employer_taxes: 0 }],
      [{ id: 'd2', default_truck_id: 'tb', name: 'Driver Two' }]
    );
    const b = result.rows.find((r) => r.truckId === 'tb')!;
    expect(b.driverPay).toBe(500);
  });

  it('returns empty rows and no Unassigned row for a fleet with no settlements at all', () => {
    const result = buildTruckComparison([truckA, truckB], [], [], [], [], [], []);
    expect(result.rows.every((r) => r.grossRevenue === 0)).toBe(true);
    expect(result.unassignedRow).toBeNull();
    expect(result.fleetTotals.grossRevenue).toBe(0);
  });
});
