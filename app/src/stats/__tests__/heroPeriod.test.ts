import { calcHeroChartPoints } from '@/src/stats/heroPeriod';
import type { WeeklyRevenueExpensePoint } from '@/src/stats/cashFlowTrend';

const NOW = new Date('2026-07-31T12:00:00');

function point(weekEnding: string, revenue: number, expenses: number): WeeklyRevenueExpensePoint {
  return { weekEnding, revenue, expenses };
}

// NARROWED (owner decision, "Dashboard Net Profit vs Expenses" root-cause
// pass) — this module (formerly `calcHeroPeriod()`) used to ALSO compute
// netProfit/deltaAmount/change; that responsibility moved to
// src/stats/kpi.ts's computeKpis() via periodScopedCpm.ts (see
// kpiConsistency.test.ts's own "Dashboard Net Profit unification" cases
// for that coverage). This file now only proves the chart-points
// windowing this module still owns.
describe('calcHeroChartPoints', () => {
  describe('thisWeek/lastWeek', () => {
    const points = [
      point('2026-07-10', 1000, 600),
      point('2026-07-17', 1200, 700),
      point('2026-07-24', 1500, 800), // lastWeek
      point('2026-07-31', 1400, 900), // thisWeek
    ];

    it('thisWeek returns up to the last 8 points ending at the latest one', () => {
      expect(calcHeroChartPoints(points, 'thisWeek', NOW)).toEqual(points);
    });

    it('lastWeek returns up to the last 8 points ending at the second-to-latest one', () => {
      expect(calcHeroChartPoints(points, 'lastWeek', NOW)).toEqual(points.slice(0, 3));
    });

    it('caps at 8 points even with a longer history', () => {
      const long = Array.from({ length: 12 }, (_, i) => point(`2026-0${(i % 9) + 1}-01`, 1000, 500));
      const result = calcHeroChartPoints(long, 'thisWeek', NOW);
      expect(result.length).toBe(8);
      expect(result[result.length - 1]).toEqual(long[long.length - 1]);
    });

    it('returns whatever exists for a brand-new account (first-ever week)', () => {
      const only = [point('2026-07-31', 1000, 500)];
      expect(calcHeroChartPoints(only, 'thisWeek', NOW)).toEqual(only);
    });

    it('returns an empty array for an account with zero settlements', () => {
      expect(calcHeroChartPoints([], 'thisWeek', NOW)).toEqual([]);
      expect(calcHeroChartPoints([], 'lastWeek', NOW)).toEqual([]);
    });
  });

  describe('rolling-window periods (1M/3M/6M/yearly)', () => {
    it('1M includes only points within the last 30 days', () => {
      const points = [
        point('2026-06-01', 1000, 500), // ~60 days before now — outside 1M
        point('2026-07-10', 1000, 600), // within last 30 days
        point('2026-07-24', 1500, 800), // within last 30 days
      ];
      expect(calcHeroChartPoints(points, '1M', NOW)).toEqual([points[1], points[2]]);
    });

    it('only includes points inside the current window, not older ones', () => {
      const points = [point('2026-01-01', 1000, 500), point('2026-07-24', 1500, 800)];
      expect(calcHeroChartPoints(points, '1M', NOW)).toEqual([point('2026-07-24', 1500, 800)]);
    });

    it('returns an empty array for an account with zero settlements', () => {
      expect(calcHeroChartPoints([], '1M', NOW)).toEqual([]);
      expect(calcHeroChartPoints([], 'yearly', NOW)).toEqual([]);
    });
  });
});
