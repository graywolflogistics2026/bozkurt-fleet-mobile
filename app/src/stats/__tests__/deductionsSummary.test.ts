import { buildDeductionsTotalsBar, buildDeductionsChartSeries, buildTopCategories, toggleDeductionSeries } from '../deductionsSummary';
import type { Deduction } from '@/src/types/db';

function ded(overrides: Partial<Deduction>): Deduction {
  return {
    id: overrides.id ?? 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    truck_id: null,
    document_id: null,
    ded_date: '2026-06-01',
    code: null,
    description: 'Deduction',
    amount: 0,
    category: null,
    store: null,
    payment_method: null,
    source: 'manual',
    warranty_years: null,
    tags: null,
    tax_deductible: true,
    reviewed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildDeductionsTotalsBar', () => {
  it('reuses the canonical origin split — Total is literally Out-of-Pocket + Withheld', () => {
    const rows = [
      ded({ id: '1', source: 'import', amount: 100 }),
      ded({ id: '2', source: 'settlement', amount: 40 }),
      ded({ id: '3', source: 'manual', amount: 25 }),
    ];
    const bar = buildDeductionsTotalsBar(rows);
    expect(bar.outOfPocket).toEqual({ amount: 125, count: 2 });
    expect(bar.withheld).toEqual({ amount: 40, count: 1 });
    expect(bar.total).toEqual({ amount: 165, count: 3 });
    expect(bar.total.amount).toBe(bar.outOfPocket.amount + bar.withheld.amount);
  });

  // NON-DEDUCTIBLE EXCLUSION (caption under Total, "excludes $X meals,
  // advances and escrow") — computed from the SAME canonical
  // NON_DEDUCTIBLE_CATEGORIES set trueProfit.ts's own exclusion list
  // mirrors, never a new/duplicate list.
  it('the caption amount sums exactly the meals/advance-repayment/escrow rows, nothing else', () => {
    const rows = [
      ded({ id: '1', category: 'Meals (per diem covered)', amount: 80 }),
      ded({ id: '2', category: 'Advance Repayment', amount: 500 }),
      ded({ id: '3', category: 'Escrow & Deposits', amount: 600 }),
      ded({ id: '4', category: 'Fuel & DEF', amount: 300 }), // a real deductible category — never counted
    ];
    const bar = buildDeductionsTotalsBar(rows);
    expect(bar.nonDeductibleAmount).toBe(1180);
    // Total still includes every row, deductible or not — the caption
    // never changes what Total itself displays.
    expect(bar.total.amount).toBe(1480);
  });

  it('handles an empty list', () => {
    const bar = buildDeductionsTotalsBar([]);
    expect(bar).toEqual({
      outOfPocket: { amount: 0, count: 0 },
      withheld: { amount: 0, count: 0 },
      total: { amount: 0, count: 0 },
      nonDeductibleAmount: 0,
    });
  });
});

describe('buildDeductionsChartSeries — period bucketing', () => {
  const NOW = new Date('2026-08-24T12:00:00Z');

  it('buckets weekly for "thisMonth"', () => {
    const rows = [
      ded({ id: '1', ded_date: '2026-08-03', source: 'import', amount: 100 }),
      ded({ id: '2', ded_date: '2026-08-10', source: 'settlement', amount: 50 }),
    ];
    const buckets = buildDeductionsChartSeries(rows, 'thisMonth', NOW);
    expect(buckets.length).toBe(2); // two different ISO weeks
    expect(buckets.every((b) => /^\d{4}-W\d{2}$/.test(b.key))).toBe(true); // isoWeekKey ("YYYY-Www") shape
  });

  it('buckets monthly for longer periods (3M/ytd/all)', () => {
    const rows = [
      ded({ id: '1', ded_date: '2026-06-05', source: 'import', amount: 100 }),
      ded({ id: '2', ded_date: '2026-06-20', source: 'settlement', amount: 50 }),
      ded({ id: '3', ded_date: '2026-07-01', source: 'import', amount: 75 }),
    ];
    const buckets = buildDeductionsChartSeries(rows, 'ytd', NOW);
    expect(buckets.map((b) => b.key)).toEqual(['2026-06', '2026-07']);
    expect(buckets[0]).toEqual({ key: '2026-06', outOfPocket: 100, withheld: 50 });
    expect(buckets[1]).toEqual({ key: '2026-07', outOfPocket: 75, withheld: 0 });
  });

  it('sums out-of-pocket and withheld independently within the same bucket', () => {
    const rows = [
      ded({ id: '1', ded_date: '2026-06-05', source: 'import', amount: 100 }),
      ded({ id: '2', ded_date: '2026-06-06', source: 'settlement', amount: 40 }),
      ded({ id: '3', ded_date: '2026-06-07', source: 'manual', amount: 10 }),
    ];
    const buckets = buildDeductionsChartSeries(rows, 'ytd', NOW);
    expect(buckets).toEqual([{ key: '2026-06', outOfPocket: 110, withheld: 40 }]);
  });

  it('sorts buckets ascending and skips rows with no date', () => {
    const rows = [
      ded({ id: '1', ded_date: '2026-07-01', amount: 10 }),
      ded({ id: '2', ded_date: '2026-05-01', amount: 20 }),
      ded({ id: '3', ded_date: null, amount: 999 }),
    ];
    const buckets = buildDeductionsChartSeries(rows, 'ytd', NOW);
    expect(buckets.map((b) => b.key)).toEqual(['2026-05', '2026-07']);
    const total = buckets.reduce((sum, b) => sum + b.outOfPocket + b.withheld, 0);
    expect(total).toBe(30); // the null-dated row never contributes anywhere
  });
});

describe('buildTopCategories', () => {
  it('ranks categories by amount, share relative to the shown total', () => {
    const rows = [
      ded({ id: '1', category: 'Fuel & DEF', amount: 600 }),
      ded({ id: '2', category: 'Maintenance & Repairs', amount: 300 }),
      ded({ id: '3', category: 'Fuel & DEF', amount: 100 }),
      ded({ id: '4', category: 'Tolls & Scales', amount: 100 }),
      ded({ id: '5', category: 'Truck Wash & Detailing', amount: 50 }),
    ];
    const top = buildTopCategories(rows, 3);
    expect(top.map((c) => c.category)).toEqual(['Fuel & DEF', 'Maintenance & Repairs', 'Tolls & Scales']);
    expect(top[0].amount).toBe(700);
    expect(top[0].share).toBeCloseTo(700 / 1150, 5);
  });

  it('falls back to "Misc" for a null category and skips zero-amount rows', () => {
    const rows = [ded({ id: '1', category: null, amount: 50 }), ded({ id: '2', category: 'Fuel & DEF', amount: 0 })];
    const top = buildTopCategories(rows);
    expect(top).toEqual([{ category: 'Misc', amount: 50, share: 1 }]);
  });

  it('handles an empty list without dividing by zero', () => {
    expect(buildTopCategories([])).toEqual([]);
  });
});

// FILTER/CHART STATE IN SYNC (spec item 2e) — the chart's own two toggle
// chips share exactly ONE piece of state with the pre-existing All/
// Out-of-pocket/Settlement segmented Pill row, and behave CONSISTENTLY
// with it: tapping "Out-of-Pocket" isolates to out-of-pocket, exactly
// like tapping the "Out-of-pocket" Pill already does — a user tapping the
// same-labeled control in either place must never get opposite results.
// Tapping the already-isolated series' own chip again is the one toggle-
// back convenience the Pills don't offer ("toggleable series," spec item
// 2c) — it restores "all" rather than requiring a trip back to the "All"
// Pill.
describe('toggleDeductionSeries', () => {
  it('tapping a series from "all" isolates it — matches tapping its own Pill', () => {
    expect(toggleDeductionSeries('all', 'outOfPocket')).toBe('outOfPocket');
    expect(toggleDeductionSeries('all', 'withheld')).toBe('withheld');
  });

  it('tapping the currently-isolated series again restores "all"', () => {
    expect(toggleDeductionSeries('outOfPocket', 'outOfPocket')).toBe('all');
    expect(toggleDeductionSeries('withheld', 'withheld')).toBe('all');
  });

  it('tapping the OTHER series while one is isolated switches to isolating that one instead', () => {
    expect(toggleDeductionSeries('outOfPocket', 'withheld')).toBe('withheld');
    expect(toggleDeductionSeries('withheld', 'outOfPocket')).toBe('outOfPocket');
  });
});
