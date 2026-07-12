import type { Load, Settlement } from '@/src/types/db';

// Weekly net/gross trend (legacy rWeeklyTrend(), legacy/index.html:1434) —
// sorted ascending by week_ending so a chart/sparkline reads left-to-right
// oldest-to-newest, matching the web app's Chart.js line chart.
export type WeeklyPoint = { weekEnding: string; gross: number; net: number };

export function buildWeeklyTrend(settlements: Settlement[]): WeeklyPoint[] {
  return [...settlements]
    .sort((a, b) => (a.week_ending ?? '').localeCompare(b.week_ending ?? ''))
    .map((s) => ({ weekEnding: s.week_ending, gross: Number(s.gross ?? 0), net: Number(s.net ?? 0) }));
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
