export const TREND_RANGES = ['7D', '30D', '90D', 'YTD'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

// Revenue trend range toggle (Session 9d item 3) — filters an already-
// built weekly trend (buildWeeklyRevenueExpenseTrend, sorted ascending) by
// how far back each week_ending falls from `now`. Settlements are the
// app's only revenue granularity (weekly, never daily — CLAUDE.md
// invariant #9's "per diem days are deterministic from week_ending"
// applies the same constraint here), so "7D" realistically shows at most
// the latest 1-2 weeks; that's expected, not a bug. YTD compares calendar
// year, not a rolling 365 days, matching how every other YTD figure in
// this app (YTD Per Diem Days, contract labor YTD) is defined.
export function filterTrendByRange<T extends { weekEnding: string }>(
  points: T[],
  range: TrendRange,
  now: Date = new Date()
): T[] {
  if (range === 'YTD') {
    const year = now.getFullYear();
    return points.filter((p) => new Date(`${p.weekEnding}T12:00:00`).getFullYear() === year);
  }
  const days = range === '7D' ? 7 : range === '30D' ? 30 : 90;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return points.filter((p) => new Date(`${p.weekEnding}T12:00:00`) >= cutoff);
}
