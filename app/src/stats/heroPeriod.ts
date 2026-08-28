import type { WeeklyRevenueExpensePoint } from '@/src/stats/cashFlowTrend';

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

// NARROWED (owner decision, "Dashboard Net Profit vs Expenses" root-cause
// pass) — this module used to ALSO compute `netProfit`/`deltaAmount`/
// `change` (the old `HeroPeriodResult` type) by summing a
// SETTLEMENT-WEEK-BUCKETED trend (`buildWeeklyTrueProfitTrend()`'s own
// output, one entry per settlement week that exists). With zero
// settlements that bucketed array is `[]`, so the old `netOf(undefined)`/
// `sumWindow([], ...)` always returned `netProfit: 0` — STRUCTURALLY,
// regardless of what real out-of-pocket expenses existed for the
// selected window, since this function never read a single raw
// deduction/fuel/maintenance/toll row. That is the confirmed root cause
// of "Net Profit $0 next to a correctly non-zero Expenses tile": Home's
// Hero Card headline (this module) and its own Revenue/Expenses trio
// (`heroPeriodWindow.ts`'s `calcHeroRevenueExpenseTrio()`, which filters
// RAW rows and has never needed a settlement to exist) were two
// genuinely different calculations that could not be forced to agree.
//
// Net Profit (and its delta) now comes from `src/stats/periodScopedCpm.ts`'s
// `buildPeriodScopedCpm()` — the SAME canonical `computeKpis()` object
// every other screen (Scorecard, AI Coach, Profit Analysis) already
// reads from, itself built entirely from raw-row date-window filtering,
// never a bucketed trend — see `app/(tabs)/index.tsx`'s own wiring. This
// module is deliberately narrowed to ONLY what still needs the bucketed
// trend for a real, distinct reason: the Hero Card's sparkline chart,
// which inherently wants "one point per settlement week" (a week with no
// settlement legitimately contributing no point to a WEEKLY chart is a
// rendering choice, not a numeric-correctness issue the way a headline
// NUMBER silently defaulting to $0 is). Keeping a full `netProfit`/
// `deltaAmount`/`change`-shaped result sitting here, unused by the
// screen that used to read it, would be exactly the kind of "unused,
// misleading parallel calculation" landmine that caused this bug in the
// first place — so those fields, `HeroPeriodResult`, and the old
// `netOf()`/`sumWindow()` revenue/expenses/net summation are removed
// entirely rather than merely left uncalled.
export function calcHeroChartPoints(points: WeeklyRevenueExpensePoint[], period: HeroPeriod, now: Date = new Date()): WeeklyRevenueExpensePoint[] {
  if (period === 'thisWeek' || period === 'lastWeek') {
    const offset = period === 'thisWeek' ? 0 : 1;
    const currentIndex = points.length - 1 - offset;
    return points.slice(Math.max(0, currentIndex - 7), currentIndex + 1);
  }

  const days = PERIOD_DAYS[period] as number;
  const windowEnd = new Date(now);
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - days);

  return points.filter((p) => {
    const d = new Date(`${p.weekEnding}T12:00:00`);
    return d >= windowStart && d < windowEnd;
  });
}
