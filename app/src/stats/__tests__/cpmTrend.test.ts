import { buildWeeklyCpmTrend, calcCpmTrends } from '@/src/stats/cpmTrend';
import type { Deduction, Settlement } from '@/src/types/db';

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
    miles: 1000,
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

describe('buildWeeklyCpmTrend', () => {
  it('computes revenue/cost/profit per mile per week from settlement gross+miles and in-window deductions', () => {
    const points = buildWeeklyCpmTrend(
      [sett({ week_ending: '2026-01-14', gross: 2000, miles: 1000 })],
      [ded({ ded_date: '2026-01-10', amount: 500 })]
    );
    expect(points).toHaveLength(1);
    expect(points[0].revenuePerMile).toBeCloseTo(2, 5);
    expect(points[0].costPerMile).toBeCloseTo(0.5, 5);
    expect(points[0].profitPerMile).toBeCloseTo(1.5, 5);
  });

  it('returns nulls for a week with zero miles', () => {
    const points = buildWeeklyCpmTrend([sett({ week_ending: '2026-01-14', miles: 0 })], []);
    expect(points[0].revenuePerMile).toBeNull();
  });
});

describe('calcCpmTrends', () => {
  it('reports "up" when the latest week beats the prior 4-week average by more than 1%', () => {
    const weeklyTrend = [
      { weekEnding: '2026-01-01', revenuePerMile: 2, costPerMile: 0.5, profitPerMile: 1.5 },
      { weekEnding: '2026-01-08', revenuePerMile: 2, costPerMile: 0.5, profitPerMile: 1.5 },
      { weekEnding: '2026-01-15', revenuePerMile: 2, costPerMile: 0.5, profitPerMile: 1.5 },
      { weekEnding: '2026-01-22', revenuePerMile: 2, costPerMile: 0.5, profitPerMile: 1.5 },
      { weekEnding: '2026-01-29', revenuePerMile: 3, costPerMile: 0.5, profitPerMile: 2.5 },
    ];
    const trends = calcCpmTrends(weeklyTrend);
    expect(trends.revenuePerMile.direction).toBe('up');
    expect(trends.revenuePerMile.priorAvg).toBeCloseTo(2, 5);
    expect(trends.profitPerMile.direction).toBe('up');
  });

  it('reports "down" when the latest week is worse than the prior average', () => {
    const weeklyTrend = [
      { weekEnding: '2026-01-01', revenuePerMile: 2, costPerMile: 0.4, profitPerMile: 1.6 },
      { weekEnding: '2026-01-08', revenuePerMile: 2, costPerMile: 0.4, profitPerMile: 1.6 },
      { weekEnding: '2026-01-15', revenuePerMile: 2, costPerMile: 0.4, profitPerMile: 1.6 },
      { weekEnding: '2026-01-22', revenuePerMile: 2, costPerMile: 0.4, profitPerMile: 1.6 },
      { weekEnding: '2026-01-29', revenuePerMile: 2, costPerMile: 0.8, profitPerMile: 1.2 },
    ];
    const trends = calcCpmTrends(weeklyTrend);
    // Cost/mile went UP (worse) — direction itself is metric-agnostic ("up"
    // means numerically higher), the Dashboard UI is what colors this red.
    expect(trends.costPerMile.direction).toBe('up');
    expect(trends.profitPerMile.direction).toBe('down');
  });

  it('reports "flat" with fewer than 4 prior weeks of data', () => {
    const weeklyTrend = [{ weekEnding: '2026-01-01', revenuePerMile: 2, costPerMile: 0.5, profitPerMile: 1.5 }];
    const trends = calcCpmTrends(weeklyTrend);
    expect(trends.revenuePerMile.direction).toBe('flat');
    expect(trends.revenuePerMile.priorAvg).toBeNull();
  });

  it('reports "flat" for an empty trend', () => {
    const trends = calcCpmTrends([]);
    expect(trends.revenuePerMile.direction).toBe('flat');
    expect(trends.revenuePerMile.current).toBeNull();
  });
});
