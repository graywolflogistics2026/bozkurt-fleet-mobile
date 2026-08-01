import { calcHeroPeriod } from '@/src/stats/heroPeriod';
import type { WeeklyRevenueExpensePoint } from '@/src/stats/cashFlowTrend';

const NOW = new Date('2026-07-31T12:00:00');

function point(weekEnding: string, revenue: number, expenses: number): WeeklyRevenueExpensePoint {
  return { weekEnding, revenue, expenses };
}

describe('calcHeroPeriod', () => {
  describe('thisWeek/lastWeek', () => {
    const points = [
      point('2026-07-10', 1000, 600), // net 400
      point('2026-07-17', 1200, 700), // net 500
      point('2026-07-24', 1500, 800), // net 700 (lastWeek)
      point('2026-07-31', 1400, 900), // net 500 (thisWeek)
    ];

    it('thisWeek compares the latest point to the one before it', () => {
      const result = calcHeroPeriod(points, 'thisWeek', NOW);
      expect(result.netProfit).toBe(500);
      expect(result.deltaAmount).toBe(500 - 700);
      expect(result.change.direction).toBe('down');
    });

    it('lastWeek compares the second-to-latest point to the one before that', () => {
      const result = calcHeroPeriod(points, 'lastWeek', NOW);
      expect(result.netProfit).toBe(700);
      expect(result.deltaAmount).toBe(700 - 500);
      expect(result.change.direction).toBe('up');
    });

    it('has no delta when there is no prior point (first-ever week)', () => {
      const result = calcHeroPeriod([point('2026-07-31', 1000, 500)], 'thisWeek', NOW);
      expect(result.deltaAmount).toBeNull();
    });
  });

  describe('rolling-window periods (1M/3M/6M/yearly)', () => {
    it('1M sums weeks within the last 30 days and compares to the preceding 30 days', () => {
      const points = [
        point('2026-06-01', 1000, 500), // net 500, ~60 days before now -> in previous 30d window (day 60 back is within [now-60,now-30))
        point('2026-07-10', 1000, 600), // net 400, within last 30 days
        point('2026-07-24', 1500, 800), // net 700, within last 30 days
      ];
      const result = calcHeroPeriod(points, '1M', NOW);
      expect(result.netProfit).toBe(400 + 700);
      expect(result.deltaAmount).toBe(1100 - 500);
    });

    it('has no delta when the preceding window has no data', () => {
      const points = [point('2026-07-24', 1500, 800)];
      const result = calcHeroPeriod(points, '1M', NOW);
      expect(result.deltaAmount).toBeNull();
    });

    it('chartPoints only includes points inside the current window', () => {
      const points = [point('2026-01-01', 1000, 500), point('2026-07-24', 1500, 800)];
      const result = calcHeroPeriod(points, '1M', NOW);
      expect(result.chartPoints).toEqual([point('2026-07-24', 1500, 800)]);
    });
  });
});
