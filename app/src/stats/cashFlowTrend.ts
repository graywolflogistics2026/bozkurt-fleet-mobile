import type { Deduction, Load, Settlement } from '@/src/types/db';

// Weekly net/gross trend (legacy rWeeklyTrend(), legacy/index.html:1434) —
// sorted ascending by week_ending so a chart/sparkline reads left-to-right
// oldest-to-newest, matching the web app's Chart.js line chart.
export type WeeklyPoint = { weekEnding: string; gross: number; net: number };

export function buildWeeklyTrend(settlements: Settlement[]): WeeklyPoint[] {
  return [...settlements]
    .sort((a, b) => (a.week_ending ?? '').localeCompare(b.week_ending ?? ''))
    .map((s) => ({ weekEnding: s.week_ending, gross: Number(s.gross ?? 0), net: Number(s.net ?? 0) }));
}

// Shared by buildWeeklyRevenueExpenseTrend/buildWeeklyCpmTrend (src/stats/
// cpmTrend.ts) — a settlement week is defined as the 7-day window ending
// at (and including) week_ending, matching the typical carrier pay-period
// convention. Exported so cpmTrend.ts doesn't reimplement it.
export function weekStartFromEnding(weekEnding: string): string {
  const d = new Date(`${weekEnding}T12:00:00`);
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

// Weekly revenue-vs-expenses trend (Dashboard Zone 1 hero chart, device
// feedback round 2 — supersedes the earlier monthly version). Groups by
// settlement week_ending (revenue = sum gross for that week); expenses =
// ALL deductions (withheld + out-of-pocket alike — same "every deduction"
// scope as Dashboard's own CPM tile and Operating P&L, CLAUDE.md
// invariant #1) whose ded_date falls within that week's 7-day window.
// Sorted ascending by week_ending so a chart reads left-to-right
// oldest-to-newest.
export type WeeklyRevenueExpensePoint = { weekEnding: string; revenue: number; expenses: number };

export function buildWeeklyRevenueExpenseTrend(settlements: Settlement[], deductions: Deduction[]): WeeklyRevenueExpensePoint[] {
  const weekEndings = [...new Set(settlements.filter((s) => s.week_ending).map((s) => s.week_ending as string))].sort();

  return weekEndings.map((weekEnding) => {
    const revenue = settlements
      .filter((s) => s.week_ending === weekEnding)
      .reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const start = weekStartFromEnding(weekEnding);
    const expenses = deductions
      .filter((d) => d.ded_date && d.ded_date >= start && d.ded_date <= weekEnding)
      .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    return { weekEnding, revenue, expenses };
  });
}

// Best/worst lanes by rate-per-loaded-mile (legacy rLoadProfit(),
// legacy/index.html:1448) — top 5 / bottom 5 of all loads with both
// loaded_miles and revenue > 0 (a load with either at 0 can't produce a
// meaningful rate and would skew the ranking).
export type RankedLoad = Load & { rpm: number };

export function rankLoadsByRpm(loads: Load[], n = 5): { best: RankedLoad[]; worst: RankedLoad[]; avgRpm: number | null } {
  const ranked = loads
    .filter((l) => Number(l.loaded_miles ?? 0) > 0 && Number(l.revenue ?? 0) > 0)
    .map((l) => ({ ...l, rpm: Number(l.revenue) / Number(l.loaded_miles) }));

  if (ranked.length === 0) return { best: [], worst: [], avgRpm: null };

  const sorted = [...ranked].sort((a, b) => b.rpm - a.rpm);
  const avgRpm = ranked.reduce((sum, l) => sum + l.rpm, 0) / ranked.length;
  const best = sorted.slice(0, n);
  const worst = sorted.slice(-n).reverse();
  return { best, worst, avgRpm };
}
