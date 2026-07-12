import { buildProfitAnalysis, compareToBenchmark, windowStartIso } from '@/src/stats/profitAnalysis';
import type { Benchmark } from '@/src/types/db';

const NOW = new Date('2026-06-30T00:00:00Z');

function benchmark(overrides: Partial<Benchmark>): Benchmark {
  return {
    id: 'b1',
    metric: 'fuel_pct_of_revenue',
    label: 'Fuel as % of revenue',
    low: 0.2,
    high: 0.28,
    unit: 'percent',
    source: 'ATRI',
    year: 2026,
    published: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('windowStartIso', () => {
  it('returns the date N days before now, ISO date only', () => {
    expect(windowStartIso(30, NOW)).toBe('2026-05-31');
  });
});

describe('buildProfitAnalysis', () => {
  const settlements = [
    { week_ending: '2026-06-15', gross: 3000, net: 2200, miles: 2000 }, // in window
    { week_ending: '2026-01-01', gross: 5000, net: 4000, miles: 2000 }, // outside window
  ];
  const fuel = [
    { purchase_date: '2026-06-20', amount: 700, discount: 50 }, // in window
    { purchase_date: '2026-01-05', amount: 999, discount: 0 }, // outside window
  ];
  const maintenance = [
    { service_date: '2026-06-10', cost: 300 }, // in window
    { service_date: '2026-01-01', cost: 999 }, // outside window
  ];

  it('sums only rows within the trailing window', () => {
    const result = buildProfitAnalysis(settlements, fuel, maintenance, 30, NOW);
    expect(result.revenue).toBe(3000);
    expect(result.netIncome).toBe(2200);
    expect(result.totalMiles).toBe(2000);
    expect(result.fuelExpense).toBe(650); // 700 - 50 discount
    expect(result.maintenanceExpense).toBe(300);
  });

  it('computes fuel % of revenue and maintenance $/mile ratios', () => {
    const result = buildProfitAnalysis(settlements, fuel, maintenance, 30, NOW);
    expect(result.fuelPctOfRevenue).toBeCloseTo(650 / 3000, 5);
    expect(result.maintenanceCostPerMile).toBeCloseTo(300 / 2000, 5);
  });

  it('returns null ratios rather than dividing by zero when revenue/miles are 0', () => {
    const result = buildProfitAnalysis([], [], [], 30, NOW);
    expect(result.fuelPctOfRevenue).toBeNull();
    expect(result.maintenanceCostPerMile).toBeNull();
  });
});

describe('compareToBenchmark', () => {
  it('flags below/within/above the published range', () => {
    const b = benchmark({ low: 0.2, high: 0.28 });
    expect(compareToBenchmark(0.15, b)).toBe('below_range');
    expect(compareToBenchmark(0.24, b)).toBe('in_range');
    expect(compareToBenchmark(0.35, b)).toBe('above_range');
  });

  it('returns no_benchmark when the value or benchmark is missing', () => {
    expect(compareToBenchmark(null, benchmark({}))).toBe('no_benchmark');
    expect(compareToBenchmark(0.2, null)).toBe('no_benchmark');
    expect(compareToBenchmark(0.2, undefined)).toBe('no_benchmark');
  });
});
