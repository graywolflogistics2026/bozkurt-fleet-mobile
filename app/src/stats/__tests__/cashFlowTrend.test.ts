import { buildWeeklyTrend, rankLoadsByRpm, buildMonthlyRevenueExpenseTrend } from '@/src/stats/cashFlowTrend';
import type { Deduction, Load, Settlement } from '@/src/types/db';

function sett(overrides: Partial<Settlement>): Settlement {
  return {
    id: 's1',
    user_id: 'u1',
    truck_id: null,
    driver_id: null,
    document_id: null,
    week_ending: '2026-01-01',
    gross: 3000,
    net: 2000,
    miles: 2000,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function load(overrides: Partial<Load>): Load {
  return {
    id: 'l1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    load_date: '2026-01-01',
    pickup_date: null,
    delivery_date: null,
    order_number: null,
    origin: 'A',
    destination: 'B',
    loaded_miles: 500,
    empty_miles: 0,
    revenue: 1000,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function ded(overrides: Partial<Deduction>): Deduction {
  return {
    id: 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    document_id: null,
    ded_date: '2026-01-01',
    code: null,
    description: null,
    amount: 100,
    category: null,
    store: null,
    payment_method: null,
    source: 'manual',
    warranty_years: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildMonthlyRevenueExpenseTrend', () => {
  it('groups settlement gross and deduction amount by calendar month', () => {
    const points = buildMonthlyRevenueExpenseTrend(
      [sett({ week_ending: '2026-01-05', gross: 1000 }), sett({ week_ending: '2026-01-19', gross: 500 })],
      [ded({ ded_date: '2026-01-10', amount: 200 })]
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ revenue: 1500, expenses: 200 });
  });

  it('sorts months chronologically even across a year boundary (zero-padded key)', () => {
    const points = buildMonthlyRevenueExpenseTrend(
      [sett({ week_ending: '2026-10-05', gross: 1 }), sett({ week_ending: '2026-02-05', gross: 2 }), sett({ week_ending: '2027-01-05', gross: 3 })],
      []
    );
    expect(points.map((p) => p.monthKey)).toEqual(['2026-02', '2026-10', '2027-01']);
  });

  it('includes ALL deductions regardless of source (withheld + out-of-pocket), matching Dashboard CPM scope', () => {
    const points = buildMonthlyRevenueExpenseTrend(
      [],
      [ded({ ded_date: '2026-03-01', amount: 100, source: 'settlement' }), ded({ ded_date: '2026-03-02', amount: 50, source: 'manual' })]
    );
    expect(points[0].expenses).toBe(150);
  });

  it('skips rows with no date', () => {
    const points = buildMonthlyRevenueExpenseTrend([sett({ week_ending: null as unknown as string })], [ded({ ded_date: null })]);
    expect(points).toHaveLength(0);
  });
});

describe('buildWeeklyTrend', () => {
  it('sorts ascending by week_ending', () => {
    const points = buildWeeklyTrend([sett({ week_ending: '2026-02-01', gross: 100, net: 80 }), sett({ week_ending: '2026-01-01', gross: 200, net: 150 })]);
    expect(points.map((p) => p.weekEnding)).toEqual(['2026-01-01', '2026-02-01']);
  });
});

describe('rankLoadsByRpm', () => {
  it('excludes loads with zero miles or zero revenue', () => {
    const result = rankLoadsByRpm([load({ id: 'a', loaded_miles: 0 }), load({ id: 'b', revenue: 0 })]);
    expect(result.best).toHaveLength(0);
    expect(result.avgRpm).toBeNull();
  });

  it('ranks best (highest rpm) and worst (lowest rpm) separately', () => {
    const loads = [
      load({ id: 'high', loaded_miles: 500, revenue: 1500 }), // $3/mi
      load({ id: 'low', loaded_miles: 500, revenue: 250 }), // $0.50/mi
      load({ id: 'mid', loaded_miles: 500, revenue: 1000 }), // $2/mi
    ];
    const result = rankLoadsByRpm(loads, 1);
    expect(result.best[0].id).toBe('high');
    expect(result.worst[0].id).toBe('low');
    expect(result.avgRpm).toBeCloseTo((3 + 0.5 + 2) / 3, 5);
  });
});
