import { buildWeeklyTrend, rankLoadsByRpm, buildWeeklyRevenueExpenseTrend } from '@/src/stats/cashFlowTrend';
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
    per_diem_days: 7,
    business_balance_credit: 0,
    tags: null,
    carrier: null,
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
    tax_deductible: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildWeeklyRevenueExpenseTrend', () => {
  it('groups settlement gross by week_ending and deductions falling within that 7-day window', () => {
    const points = buildWeeklyRevenueExpenseTrend(
      [sett({ week_ending: '2026-01-14', gross: 1000 })],
      [
        ded({ ded_date: '2026-01-10', amount: 200 }), // within [01-08, 01-14]
        ded({ ded_date: '2026-01-07', amount: 999 }), // outside (one day early)
      ]
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ weekEnding: '2026-01-14', revenue: 1000, expenses: 200 });
  });

  it('sums multiple settlements sharing the same week_ending', () => {
    const points = buildWeeklyRevenueExpenseTrend(
      [sett({ week_ending: '2026-01-14', gross: 1000 }), sett({ week_ending: '2026-01-14', gross: 500 })],
      []
    );
    expect(points[0].revenue).toBe(1500);
  });

  it('sorts weeks chronologically ascending', () => {
    const points = buildWeeklyRevenueExpenseTrend(
      [sett({ week_ending: '2026-02-01', gross: 1 }), sett({ week_ending: '2026-01-01', gross: 2 })],
      []
    );
    expect(points.map((p) => p.weekEnding)).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('includes ALL deductions regardless of source (withheld + out-of-pocket), matching Dashboard CPM scope', () => {
    const points = buildWeeklyRevenueExpenseTrend(
      [sett({ week_ending: '2026-03-07', gross: 0 })],
      [ded({ ded_date: '2026-03-01', amount: 100, source: 'settlement' }), ded({ ded_date: '2026-03-02', amount: 50, source: 'manual' })]
    );
    expect(points[0].expenses).toBe(150);
  });

  it('skips settlements with no week_ending', () => {
    const points = buildWeeklyRevenueExpenseTrend([sett({ week_ending: null as unknown as string })], []);
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
    const result = rankLoadsByRpm([load({ id: 'a', order_number: 'A', loaded_miles: 0 }), load({ id: 'b', order_number: 'B', revenue: 0 })]);
    expect(result.best).toHaveLength(0);
    expect(result.avgRpm).toBeNull();
  });

  it('ranks best (highest rpm) and worst (lowest rpm) separately', () => {
    const loads = [
      load({ id: 'high', order_number: 'H', loaded_miles: 500, revenue: 1500 }), // $3/mi
      load({ id: 'low', order_number: 'L', loaded_miles: 500, revenue: 900 }), // $1.80/mi
      load({ id: 'mid', order_number: 'M', loaded_miles: 500, revenue: 1000 }), // $2/mi
    ];
    const result = rankLoadsByRpm(loads, 1);
    expect(result.best[0].id).toBe('high');
    expect(result.worst[0].id).toBe('low');
  });

  it('avgRpm is total revenue / total loaded miles (mileage-weighted), not the mean of each load\'s own rate — owner decision 2026-08-05, FULL PARITY pass item C.5', () => {
    const loads = [
      load({ id: 'a', order_number: 'A', loaded_miles: 100, revenue: 500 }), // $5/mi, tiny mileage
      load({ id: 'b', order_number: 'B', loaded_miles: 900, revenue: 900 }), // $1/mi, most of the mileage
    ];
    const result = rankLoadsByRpm(loads);
    // Unweighted mean would be (5+1)/2=3; weighted is (500+900)/(100+900)=1.4
    expect(result.avgRpm).toBeCloseTo((500 + 900) / (100 + 900), 5);
  });

  it('de-duplicates by order+lane, keeping the first-seen row', () => {
    const loads = [
      load({ id: 'first', order_number: 'DUP1', origin: 'Dallas, TX', destination: 'Atlanta, GA', loaded_miles: 500, revenue: 1000 }),
      load({ id: 'second', order_number: 'DUP1', origin: 'Dallas, TX', destination: 'Atlanta, GA', loaded_miles: 500, revenue: 1000 }),
      load({ id: 'other', order_number: 'DUP2', origin: 'Miami, FL', destination: 'Orlando, FL', loaded_miles: 200, revenue: 300 }),
    ];
    const result = rankLoadsByRpm(loads);
    const rankedIds = new Set(result.best.map((l) => l.id));
    expect(rankedIds.has('second')).toBe(false);
    expect(rankedIds.has('first')).toBe(true);
    expect(rankedIds.has('other')).toBe(true);
    expect(rankedIds.size).toBe(2); // 'second' deduped away, only 'first' + 'other' remain
  });

  it('excludes implausible rates ($0.80-$12/loaded mile) into their own list, never into best/worst/avgRpm', () => {
    const loads = [
      load({ id: 'plausible', order_number: 'P', loaded_miles: 500, revenue: 1000 }), // $2/mi
      load({ id: 'too-low', order_number: 'LO', loaded_miles: 500, revenue: 100 }), // $0.20/mi — mis-read
      load({ id: 'too-high', order_number: 'HI', loaded_miles: 10, revenue: 500 }), // $50/mi — mis-read
    ];
    const result = rankLoadsByRpm(loads);
    expect(result.best.map((l) => l.id)).toEqual(['plausible']);
    expect(result.excluded.map((l) => l.id).sort()).toEqual(['too-high', 'too-low']);
    expect(result.avgRpm).toBeCloseTo(2, 5); // implausible loads never pollute the average
  });
});
