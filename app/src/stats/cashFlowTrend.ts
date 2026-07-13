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

// Monthly revenue-vs-expenses trend (legacy rChart(), legacy/index.html:1464)
// — Dashboard's line chart, distinct from the weekly gross/net trend above.
// Ported verbatim: group settlements by calendar month of s.date (revenue =
// sum gross), group ALL deductions by calendar month of ded_date (expenses =
// sum amount, withheld + out-of-pocket alike — same "every deduction" scope
// as Dashboard's own CPM tile and Operating P&L, CLAUDE.md invariant #1),
// sorted ascending by month key so a chart reads left-to-right oldest-to-newest.
export type MonthlyRevenueExpensePoint = { monthKey: string; label: string; revenue: number; expenses: number };

export function buildMonthlyRevenueExpenseTrend(settlements: Settlement[], deductions: Deduction[]): MonthlyRevenueExpensePoint[] {
  const months = new Map<string, MonthlyRevenueExpensePoint>();

  function monthKeyAndLabel(dateStr: string) {
    const d = new Date(`${dateStr}T12:00:00`);
    // Zero-padded month so string-sorting the keys below is chronological
    // (legacy's unpadded 'YYYY-M' key sorts "…-10" before "…-2" — an
    // ordering bug, not a business rule worth porting).
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return { key, label };
  }

  for (const s of settlements) {
    if (!s.week_ending) continue;
    const { key, label } = monthKeyAndLabel(s.week_ending);
    const entry = months.get(key) ?? { monthKey: key, label, revenue: 0, expenses: 0 };
    entry.revenue += Number(s.gross ?? 0);
    months.set(key, entry);
  }
  for (const d of deductions) {
    if (!d.ded_date) continue;
    const { key, label } = monthKeyAndLabel(d.ded_date);
    const entry = months.get(key) ?? { monthKey: key, label, revenue: 0, expenses: 0 };
    entry.expenses += Number(d.amount ?? 0);
    months.set(key, entry);
  }

  return [...months.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
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
