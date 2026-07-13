import { calcCpm } from '@/src/stats/cpm';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';
import type { Deduction, Settlement } from '@/src/types/db';

// Dashboard Zone 4's per-mile trio trend arrows (device feedback round 2)
// — same per-week grouping as buildWeeklyRevenueExpenseTrend, but also
// carries miles so calcCpm() can be applied per week.
export type WeeklyCpmPoint = {
  weekEnding: string;
  revenuePerMile: number | null;
  costPerMile: number | null;
  profitPerMile: number | null;
};

export function buildWeeklyCpmTrend(settlements: Settlement[], deductions: Deduction[]): WeeklyCpmPoint[] {
  const weekEndings = [...new Set(settlements.filter((s) => s.week_ending).map((s) => s.week_ending as string))].sort();

  return weekEndings.map((weekEnding) => {
    const weekSettlements = settlements.filter((s) => s.week_ending === weekEnding);
    const gross = weekSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const miles = weekSettlements.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);
    const start = weekStartFromEnding(weekEnding);
    const expenses = deductions
      .filter((d) => d.ded_date && d.ded_date >= start && d.ded_date <= weekEnding)
      .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    const cpm = calcCpm(gross, expenses, miles);
    return { weekEnding, ...cpm };
  });
}

export type TrendDirection = 'up' | 'down' | 'flat';
export type MetricTrend = { current: number | null; priorAvg: number | null; direction: TrendDirection };

// direction is purely "current vs. the prior 4 weeks' average" — it does
// NOT judge whether up is good or bad (revenue/profit per mile: up is
// good; cost per mile: up is bad). That judgment belongs to the caller
// (Dashboard's UI coloring), not this pure calculation. A >1% move either
// way counts as up/down; anything closer reads as flat rather than
// flip-flopping color on noise.
function trendFor(current: number | null, priorValues: (number | null)[]): MetricTrend {
  const validPrior = priorValues.filter((v): v is number => v != null);
  if (current == null || validPrior.length === 0) return { current, priorAvg: null, direction: 'flat' };
  const priorAvg = validPrior.reduce((a, b) => a + b, 0) / validPrior.length;
  const direction: TrendDirection = current > priorAvg * 1.01 ? 'up' : current < priorAvg * 0.99 ? 'down' : 'flat';
  return { current, priorAvg, direction };
}

export type CpmTrends = {
  revenuePerMile: MetricTrend;
  costPerMile: MetricTrend;
  profitPerMile: MetricTrend;
};

// Compares the latest completed week against the average of the 4 weeks
// before it (weeklyTrend must already be sorted ascending, as
// buildWeeklyCpmTrend returns it).
export function calcCpmTrends(weeklyTrend: WeeklyCpmPoint[]): CpmTrends {
  const last = weeklyTrend[weeklyTrend.length - 1];
  const prior = weeklyTrend.slice(-5, -1);
  return {
    revenuePerMile: trendFor(last?.revenuePerMile ?? null, prior.map((p) => p.revenuePerMile)),
    costPerMile: trendFor(last?.costPerMile ?? null, prior.map((p) => p.costPerMile)),
    profitPerMile: trendFor(last?.profitPerMile ?? null, prior.map((p) => p.profitPerMile)),
  };
}
