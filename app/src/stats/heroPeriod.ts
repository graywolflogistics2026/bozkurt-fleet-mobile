import type { WeeklyRevenueExpensePoint } from '@/src/stats/cashFlowTrend';
import { calcWeekOverWeekChange, type WeekOverWeekChange } from '@/src/stats/heroStats';

// UX MEGA-PASS item G (owner decision 2026-07-31): the Hero Card gets
// period tabs driving its number/delta/chart all together, instead of
// being permanently pinned to "this week." Settlements are the app's
// only revenue granularity (weekly — CLAUDE.md invariant #9), so
// 'thisWeek'/'lastWeek' stay a straight two-point comparison (identical
// to the pre-existing Hero Card logic, just made period-selectable);
// '1M'/'3M'/'6M'/'yearly' aggregate (sum) revenue/expenses across every
// settlement week whose weekEnding falls in a rolling N-day window
// (30/90/180/365), compared against the immediately PRECEDING
// equal-length window — a rolling window, not a calendar-year YTD like
// the unrelated "YTD Per Diem Days" stat, so every non-weekly period's
// delta is defined the same consistent way: this window vs the window
// right before it.
export const HERO_PERIODS = ['thisWeek', 'lastWeek', '1M', '3M', '6M', 'yearly'] as const;
export type HeroPeriod = (typeof HERO_PERIODS)[number];

const PERIOD_DAYS: Partial<Record<HeroPeriod, number>> = { '1M': 30, '3M': 90, '6M': 180, yearly: 365 };

export type HeroPeriodResult = {
  netProfit: number;
  deltaAmount: number | null;
  change: WeekOverWeekChange;
  chartPoints: WeeklyRevenueExpensePoint[];
};

function netOf(p: WeeklyRevenueExpensePoint | undefined): number {
  return p ? p.revenue - p.expenses : 0;
}

function sumWindow(
  points: WeeklyRevenueExpensePoint[],
  start: Date,
  end: Date
): { revenue: number; expenses: number; net: number; points: WeeklyRevenueExpensePoint[] } {
  const inWindow = points.filter((p) => {
    const d = new Date(`${p.weekEnding}T12:00:00`);
    return d >= start && d < end;
  });
  const revenue = inWindow.reduce((sum, p) => sum + p.revenue, 0);
  const expenses = inWindow.reduce((sum, p) => sum + p.expenses, 0);
  // Identical to the old `inWindow.reduce((sum, p) => sum + netOf(p), 0)` —
  // sum(revenue - expenses) === sum(revenue) - sum(expenses) — so
  // calcHeroPeriod()'s own pre-existing behavior is unchanged by this
  // refactor; only the newly-exposed revenue/expenses fields are new.
  return { revenue, expenses, net: revenue - expenses, points: inWindow };
}

// `points` must be sorted ascending by weekEnding (buildWeeklyRevenueExpenseTrend's
// own output order) and unsliced — this function does its own windowing.
export function calcHeroPeriod(points: WeeklyRevenueExpensePoint[], period: HeroPeriod, now: Date = new Date()): HeroPeriodResult {
  if (period === 'thisWeek' || period === 'lastWeek') {
    const offset = period === 'thisWeek' ? 0 : 1;
    const currentIndex = points.length - 1 - offset;
    const current = points[currentIndex];
    const previous = points[currentIndex - 1];
    const currentNet = netOf(current);
    const previousNet = previous ? netOf(previous) : null;
    return {
      netProfit: currentNet,
      deltaAmount: previousNet == null ? null : currentNet - previousNet,
      change: calcWeekOverWeekChange(currentNet, previousNet),
      chartPoints: points.slice(Math.max(0, currentIndex - 7), currentIndex + 1),
    };
  }

  const days = PERIOD_DAYS[period] as number;
  const windowEnd = new Date(now);
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - days);
  const prevWindowStart = new Date(windowStart);
  prevWindowStart.setDate(prevWindowStart.getDate() - days);

  const currentWindow = sumWindow(points, windowStart, windowEnd);
  const previousWindow = sumWindow(points, prevWindowStart, windowStart);
  const hasPreviousData = previousWindow.points.length > 0;

  return {
    netProfit: currentWindow.net,
    deltaAmount: hasPreviousData ? currentWindow.net - previousWindow.net : null,
    change: calcWeekOverWeekChange(currentWindow.net, hasPreviousData ? previousWindow.net : null),
    chartPoints: currentWindow.points,
  };
}
