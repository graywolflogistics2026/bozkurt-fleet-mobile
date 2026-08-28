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
    const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, windowStartIso(30, NOW), NOW);
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
    const result = buildProfitAnalysis(settlements, [], [], deductions, windowStartIso(30, NOW), NOW);
    expect(result.netIncome).toBe(2800); // the $40 non-deductible row never subtracted (no fuel/maintenance passed here)
  });

  it('excludes a SETTLEMENT-LINKED fuel purchase from netIncome (already represented by the settlement\'s own withheld deductions) but still shows it in the fuelExpense tile', () => {
    const linkedFuel = [{ purchase_date: '2026-06-20', amount: 700, discount: 50, settlement_id: 'sett-1' }];
    const result = buildProfitAnalysis(settlements, linkedFuel, [], [], windowStartIso(30, NOW), NOW);
    expect(result.netIncome).toBe(3000); // settlement-linked fuel not double-subtracted
    expect(result.fuelExpense).toBe(650); // still shown in the display tile
  });

  it('computes fuel % of revenue and maintenance $/mile ratios', () => {
    const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, windowStartIso(30, NOW), NOW);
    expect(result.fuelPctOfRevenue).toBeCloseTo(650 / 3000, 5);
    expect(result.maintenanceCostPerMile).toBeCloseTo(300 / 2000, 5);
  });

  it('returns null ratios rather than dividing by zero when revenue/miles are 0', () => {
    const result = buildProfitAnalysis([], [], [], [], windowStartIso(30, NOW), NOW);
    expect(result.fuelPctOfRevenue).toBeNull();
    expect(result.maintenanceCostPerMile).toBeNull();
  });

  // "GHOST VALUE" pass (owner decision 2026-08-28) — startIso is now an
  // explicit caller-supplied bound (or null for 'all') instead of a
  // baked-in windowDays count, and the return value exposes the full
  // reconciliation breakdown.
  describe('explicit startIso / null bound / reconciliation breakdown', () => {
    it('startIso=null (the "all" period) includes every row regardless of date', () => {
      const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, null, NOW);
      expect(result.revenue).toBe(8000); // both settlements
      expect(result.deductionsGrossTotal).toBe(1239); // 200 + 40 + 999
      expect(result.startIso).toBeNull();
    });

    it('deductionsGrossTotal matches the unconditional sum every deduction row contributes for the SAME date range — the exact figure Deductions\' own "Total" tile shows', () => {
      const result = buildProfitAnalysis([], [], [], deductions, windowStartIso(30, NOW), NOW);
      // Both in-window rows (200 deductible + 40 non-deductible) — unconditional,
      // matching buildDeductionsTotalsBar()'s own "Total = every row's amount" rule.
      expect(result.deductionsGrossTotal).toBe(240);
      expect(result.deductionsCountedTotal).toBe(200); // only what actually reduces netIncome
      expect(result.deductionsExcludedTotal).toBe(40); // gross - counted, reconciles exactly
      expect(result.deductionsGrossTotal).toBe(result.deductionsCountedTotal + result.deductionsExcludedTotal);
    });

    it('totalExpenses always equals revenue - netIncome, and equals deductionsCountedTotal + canonicalFuelExpense + maintenanceExpense + tollsExpense', () => {
      const tolls = [{ toll_date: '2026-06-14', amount: 15 }];
      const result = buildProfitAnalysis(settlements, fuel, maintenance, deductions, windowStartIso(30, NOW), NOW, tolls);
      expect(result.totalExpenses).toBeCloseTo(result.revenue - result.netIncome, 6);
      expect(result.totalExpenses).toBeCloseTo(
        result.deductionsCountedTotal + result.canonicalFuelExpense + result.maintenanceExpense + result.tollsExpense,
        6
      );
      expect(result.tollsExpense).toBe(15);
    });

    it('canonicalFuelExpense excludes settlement-linked fuel while fuelExpense (the display tile) still includes it', () => {
      const linkedFuel = [{ purchase_date: '2026-06-20', amount: 700, discount: 50, settlement_id: 'sett-1' }];
      const result = buildProfitAnalysis(settlements, linkedFuel, [], [], windowStartIso(30, NOW), NOW);
      expect(result.fuelExpense).toBe(650);
      expect(result.canonicalFuelExpense).toBe(0);
    });

    // THE EXACT REPORTED SYMPTOM (device report, 2026-08-28): "-$1,372.98
    // trailing 30 days vs. $5,800.72 all-time" — reproduces this shape and
    // proves it is a genuine, correctly-computed SCOPE difference (not
    // stale/wrong data): the smaller 30-day figure is the true subset of
    // the larger all-time figure, and both are live, deterministic
    // functions of the SAME input rows for their own date range.
    it('a zero-revenue, manual-deductions-only account: the "all" period returns the full deductions total; a narrower period returns only its own true subset', () => {
      const now = new Date('2026-08-28T12:00:00Z');
      const manualDeductions = [
        { ded_date: '2026-07-01', amount: 4427.74, tax_deductible: true }, // outside the trailing 30 days from 2026-08-28
        { ded_date: '2026-08-10', amount: 872.98, tax_deductible: true }, // inside
        { ded_date: '2026-08-20', amount: 500.0, tax_deductible: true }, // inside
      ];
      // 872.98 + 500.00 = 1372.98 — the exact reported "ghost" figure.
      const trailing30 = buildProfitAnalysis([], [], [], manualDeductions, windowStartIso(30, now), now);
      expect(trailing30.revenue).toBe(0);
      expect(trailing30.netIncome).toBeCloseTo(-1372.98, 2);
      expect(trailing30.deductionsGrossTotal).toBeCloseTo(1372.98, 2);

      // 4427.74 + 872.98 + 500.00 = 5800.72 — the exact reported Deductions
      // screen "Total" figure, for the SAME rows under the 'all' period.
      const allTime = buildProfitAnalysis([], [], [], manualDeductions, null, now);
      expect(allTime.revenue).toBe(0);
      expect(allTime.netIncome).toBeCloseTo(-5800.72, 2);
      expect(allTime.deductionsGrossTotal).toBeCloseTo(5800.72, 2);

      // The 30-day figure is a strict, real subset of the all-time one —
      // never a different/unrelated number.
      expect(trailing30.deductionsGrossTotal).toBeLessThan(allTime.deductionsGrossTotal);
    });
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
