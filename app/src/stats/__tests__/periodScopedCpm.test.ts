import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import type { ComparisonTruck, ComparisonSettlement, ComparisonDeduction } from '@/src/stats/truckComparison';

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

// A realistic multi-month dataset, gross/miles/deduction amounts
// deliberately DIFFERENT every week so each period tab's own aggregation
// window produces a genuinely different RPM/CPM/PPM — never just a
// scaled multiple of the same per-week ratio, which would mask a bug
// that silently used the wrong window.
const settlements: ComparisonSettlement[] = [
  { id: 's0', truck_id: 'ta', week_ending: '2026-01-10', gross: 800, net: 750, miles: 400 },
  { id: 's1', truck_id: 'ta', week_ending: '2026-05-02', gross: 900, net: 850, miles: 450 },
  { id: 's2', truck_id: 'ta', week_ending: '2026-06-06', gross: 1000, net: 950, miles: 500 },
  { id: 's3', truck_id: 'ta', week_ending: '2026-07-04', gross: 1100, net: 1040, miles: 500 },
  { id: 's4', truck_id: 'ta', week_ending: '2026-08-01', gross: 1200, net: 1130, miles: 500 },
  { id: 's5', truck_id: 'ta', week_ending: '2026-08-08', gross: 1300, net: 1220, miles: 500 },
  { id: 's6', truck_id: 'ta', week_ending: '2026-08-15', gross: 1400, net: 1310, miles: 500 },
  { id: 's7', truck_id: 'ta', week_ending: '2026-08-22', gross: 1500, net: 1400, miles: 500 },
];
const weekEndings = settlements.map((s) => s.week_ending as string);

function ded(dedDate: string, amount: number): ComparisonDeduction & { ded_date: string | null } {
  return { amount, category: 'Maintenance & Repairs', tax_deductible: true, source: 'manual', truck_id: 'ta', ded_date: dedDate };
}
const deductions = [
  ded('2026-01-10', 50),
  ded('2026-05-02', 60),
  ded('2026-06-06', 70),
  ded('2026-07-04', 80),
  ded('2026-08-01', 90),
  ded('2026-08-08', 100),
  ded('2026-08-15', 110),
  ded('2026-08-22', 120),
];

const now = new Date('2026-08-24T12:00:00');

describe('buildPeriodScopedCpm — a dataset spanning several months, each period tab produces a different, correct trio', () => {
  it('"thisWeek" uses only the LATEST settlement week (2026-08-22)', () => {
    const result = buildPeriodScopedCpm('thisWeek', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    expect(result.window).toEqual({ startIso: '2026-08-16', endIso: '2026-08-22' });
    expect(result.cpm!.revenuePerMile).toBeCloseTo(1500 / 500, 5);
    expect(result.cpm!.costPerMile).toBeCloseTo(120 / 500, 5);
    expect(result.cpm!.profitPerMile).toBeCloseTo(1500 / 500 - 120 / 500, 5);
  });

  it('"lastWeek" uses the settlement week BEFORE that (2026-08-15) — a genuinely different trio than "thisWeek"', () => {
    const result = buildPeriodScopedCpm('lastWeek', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    expect(result.window).toEqual({ startIso: '2026-08-09', endIso: '2026-08-15' });
    expect(result.cpm!.revenuePerMile).toBeCloseTo(1400 / 500, 5);
    expect(result.cpm!.costPerMile).toBeCloseTo(110 / 500, 5);
  });

  it('"1M" aggregates the trailing 30 days (4 settlement weeks: 08-01..08-22) — different again', () => {
    const result = buildPeriodScopedCpm('1M', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    const revenue = 1200 + 1300 + 1400 + 1500;
    const miles = 500 * 4;
    const cost = 90 + 100 + 110 + 120;
    expect(result.window).toEqual({ startIso: '2026-07-25', endIso: '2026-08-24' });
    expect(result.cpm!.revenuePerMile).toBeCloseTo(revenue / miles, 5);
    expect(result.cpm!.costPerMile).toBeCloseTo(cost / miles, 5);
  });

  it('"3M" aggregates the trailing 90 days (6 settlement weeks: 06-06..08-22) — different again', () => {
    const result = buildPeriodScopedCpm('3M', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    const revenue = 1000 + 1100 + 1200 + 1300 + 1400 + 1500;
    const miles = 500 * 6;
    const cost = 70 + 80 + 90 + 100 + 110 + 120;
    expect(result.window).toEqual({ startIso: '2026-05-26', endIso: '2026-08-24' });
    expect(result.cpm!.revenuePerMile).toBeCloseTo(revenue / miles, 5);
    expect(result.cpm!.costPerMile).toBeCloseTo(cost / miles, 5);
  });

  it('"6M" (trailing 180 days) excludes the oldest settlement (2026-01-10) that "yearly" includes — the two periods must differ', () => {
    const sixMonth = buildPeriodScopedCpm('6M', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    const yearly = buildPeriodScopedCpm('yearly', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    expect(sixMonth.window).toEqual({ startIso: '2026-02-25', endIso: '2026-08-24' });
    expect(yearly.window).toEqual({ startIso: '2025-08-24', endIso: '2026-08-24' });
    // 6M: s1..s7 (excludes s0); yearly: s0..s7 (includes it) — genuinely
    // different settlement sets, so genuinely different trios.
    const sixMonthRevenue = 900 + 1000 + 1100 + 1200 + 1300 + 1400 + 1500;
    const sixMonthMiles = 450 + 500 * 6;
    expect(sixMonth.cpm!.revenuePerMile).toBeCloseTo(sixMonthRevenue / sixMonthMiles, 5);
    const yearlyRevenue = sixMonthRevenue + 800;
    const yearlyMiles = sixMonthMiles + 400;
    expect(yearly.cpm!.revenuePerMile).toBeCloseTo(yearlyRevenue / yearlyMiles, 5);
    expect(sixMonth.cpm!.revenuePerMile).not.toBeCloseTo(yearly.cpm!.revenuePerMile as number, 5);
  });

  it('every period above produced a DISTINCT revenuePerMile — proves the trio actually moves when the tab changes', () => {
    const periods = ['thisWeek', 'lastWeek', '1M', '3M', '6M', 'yearly'] as const;
    const rpms = periods.map(
      (p) => buildPeriodScopedCpm(p, weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now).cpm!.revenuePerMile
    );
    expect(new Set(rpms.map((r) => r!.toFixed(4))).size).toBe(periods.length);
  });

  it('numerator and denominator are always drawn from the identical window — costPerMile never divides a period-filtered cost by all-time miles or vice versa', () => {
    const result = buildPeriodScopedCpm('1M', weekEndings, [truckA], settlements, [], deductions, [], [], [], 'ta', undefined, now);
    // Manually recompute from the same 4-settlement window to prove the
    // function isn't secretly mixing a wider/narrower miles figure in.
    const windowSettlements = settlements.filter((s) => (s.week_ending as string) >= '2026-07-25' && (s.week_ending as string) <= '2026-08-24');
    const expectedMiles = windowSettlements.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);
    const expectedCost = deductions
      .filter((d) => d.ded_date! >= '2026-07-25' && d.ded_date! <= '2026-08-24')
      .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    expect(result.cpm!.costPerMile).toBeCloseTo(expectedCost / expectedMiles, 5);
  });

  it('returns cpm: null and window: null for "This Week" on a truck/account with zero settlements — never a silent all-time fallback', () => {
    const result = buildPeriodScopedCpm('thisWeek', [], [truckA], [], [], [], [], [], [], 'ta', undefined, now);
    expect(result.window).toBeNull();
    expect(result.cpm).toBeNull();
  });

  it('"All Trucks" scope (activeTruckId null) still reconciles to the same window-filtered totals', () => {
    const result = buildPeriodScopedCpm('thisWeek', weekEndings, [truckA], settlements, [], deductions, [], [], [], null, undefined, now);
    expect(result.scopedRow).toBeNull();
    expect(result.cpm!.revenuePerMile).toBeCloseTo(1500 / 500, 5);
  });
});

describe('buildPeriodScopedCpm — fixed cost pro-ration', () => {
  const truckWithCostBasis: ComparisonTruck = {
    ...truckA,
    cost_basis_ownership_mode: 'paid',
    purchase_price: 52000,
    cost_basis_paid_spread_months: 52, // -> $1000/month -> ~$230.769/week
  };
  const weeklyFixed = ((52000 / 52) * 12) / 52;

  it('"This Week" (1 settlement) charges exactly ONE week of fixed cost — never a multi-week lump sum', () => {
    const result = buildPeriodScopedCpm(
      'thisWeek',
      weekEndings,
      [truckWithCostBasis],
      settlements,
      [],
      [],
      [],
      [],
      [],
      'ta',
      undefined,
      now
    );
    expect(result.cpm!.costPerMile).toBeCloseTo(weeklyFixed / 500, 4);
  });

  it('"1M" (4 settlements) charges exactly FOUR weeks of fixed cost — pro-rated to the window, not a flat one-week charge', () => {
    const result = buildPeriodScopedCpm('1M', weekEndings, [truckWithCostBasis], settlements, [], [], [], [], [], 'ta', undefined, now);
    const miles = 500 * 4;
    expect(result.cpm!.costPerMile).toBeCloseTo((weeklyFixed * 4) / miles, 4);
  });
});
