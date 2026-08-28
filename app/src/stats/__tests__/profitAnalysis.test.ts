import { buildProfitAnalysis, compareToBenchmark, windowStartIso } from '@/src/stats/profitAnalysis';
import { resolveHeroPeriodDateWindow } from '@/src/stats/heroPeriodWindow';
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

  // ONE KPI ENGINE (owner decision, device report: "Profit Analysis...
  // independent of what Dashboard/Scorecard/AI Coach show for the same
  // period and scope") — proves the actual root cause and its fix: a
  // 30-day window computed here must always match the SAME window
  // resolveHeroPeriodDateWindow('1M', ...) computes for Home/Scorecard/AI
  // Coach, in every timezone, including one that crosses a DST boundary
  // within the 30-day span (the exact case a UTC-vs-local mismatch could
  // silently produce a different calendar day for).
  it('matches resolveHeroPeriodDateWindow(\'1M\', ...) exactly, across timezones', () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ['America/Chicago', 'UTC', 'Pacific/Honolulu', 'Europe/London']) {
        process.env.TZ = tz;
        const now = new Date('2026-06-30T00:00:00Z');
        const heroWindow = resolveHeroPeriodDateWindow('1M', [], now)!;
        expect(windowStartIso(30, now)).toBe(heroWindow.startIso);
      }
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('still matches resolveHeroPeriodDateWindow(\'1M\', ...) when the 30-day window crosses a real DST boundary (America/Chicago\'s own 2026-03-08 start)', () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/Chicago';
      const dstNow = new Date('2026-03-20T23:30:00.000Z');
      const dstHeroWindow = resolveHeroPeriodDateWindow('1M', [], dstNow)!;
      expect(windowStartIso(30, dstNow)).toBe(dstHeroWindow.startIso);
      expect(windowStartIso(30, dstNow)).toBe('2026-02-19');

      // Reproduces the OLD buggy implementation (setUTCDate) directly to
      // prove this test would have caught the original divergence, not
      // just asserted behavior the fix already guarantees.
      const oldBuggyImpl = (days: number, n: Date) => {
        const d = new Date(n);
        d.setUTCDate(d.getUTCDate() - days);
        return d.toISOString().slice(0, 10);
      };
      expect(oldBuggyImpl(30, dstNow)).toBe('2026-02-18');
      expect(oldBuggyImpl(30, dstNow)).not.toBe(windowStartIso(30, dstNow));
    } finally {
      process.env.TZ = originalTz;
    }
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
  const deductions = [
    { ded_date: '2026-06-12', amount: 200, tax_deductible: true }, // in window, deductible
    { ded_date: '2026-06-13', amount: 40, tax_deductible: false }, // in window, non-deductible (excluded)
    { ded_date: '2026-01-02', amount: 999, tax_deductible: true }, // outside window
  ];

  it('sums only rows within the trailing window', () => {
    const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, 30, NOW);
    expect(result.revenue).toBe(3000);
    // FULL PARITY pass (owner decision 2026-08-05, spec item C.2): netIncome
    // now genuinely subtracts fuel/maintenance too, not just deductions —
    // netIncome = revenue (3000) - deductions (200) - fuel (650) - maintenance
    // (300) = 1850 (settlement.net's own 2200 is NOT used — TRUE-PROFIT
    // CONSISTENCY). Before this pass, fuelExpense/maintenanceExpense were
    // computed and displayed as their own tiles but silently never actually
    // reduced netIncome — this is the fix, not a regression.
    expect(result.netIncome).toBe(1850);
    expect(result.totalMiles).toBe(2000);
    expect(result.fuelExpense).toBe(650); // 700 - 50 discount
    expect(result.maintenanceExpense).toBe(300);
  });

  it('excludes non-deductible rows (a Meal covered by per diem, an Advance Repayment) from netIncome', () => {
    const result = buildProfitAnalysis(settlements, [], [], deductions, 30, NOW);
    expect(result.netIncome).toBe(2800); // the $40 non-deductible row never subtracted (no fuel/maintenance passed here)
  });

  it('excludes a SETTLEMENT-LINKED fuel purchase from netIncome (already represented by the settlement\'s own withheld deductions) but still shows it in the fuelExpense tile', () => {
    const linkedFuel = [{ purchase_date: '2026-06-20', amount: 700, discount: 50, settlement_id: 'sett-1' }];
    const result = buildProfitAnalysis(settlements, linkedFuel, [], [], 30, NOW);
    expect(result.netIncome).toBe(3000); // settlement-linked fuel not double-subtracted
    expect(result.fuelExpense).toBe(650); // still shown in the display tile
  });

  it('computes fuel % of revenue and maintenance $/mile ratios', () => {
    const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, 30, NOW);
    expect(result.fuelPctOfRevenue).toBeCloseTo(650 / 3000, 5);
    expect(result.maintenanceCostPerMile).toBeCloseTo(300 / 2000, 5);
  });

  it('returns null ratios rather than dividing by zero when revenue/miles are 0', () => {
    const result = buildProfitAnalysis([], [], [], [], 30, NOW);
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
