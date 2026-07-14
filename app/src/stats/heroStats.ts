export type TrendDirection = 'up' | 'down' | 'flat';
export type WeekOverWeekChange = { pct: number | null; direction: TrendDirection };

// Hero Card's "vs last week" comparison (Session 9d item 1) — a straight
// two-point comparison, deliberately NOT src/stats/cpmTrend.ts's
// prior-4-week-average smoothing (that trio is noisier per-mile data; a
// single headline weekly figure reads better against the one week right
// before it). Same >1% "flat" threshold as cpmTrend.ts so trend arrows
// feel consistent across the dashboard. previous == null/0 (no prior week
// yet, e.g. a brand-new account's first settlement) reports no
// percentage rather than a misleading +Infinity%.
export function calcWeekOverWeekChange(current: number, previous: number | null | undefined): WeekOverWeekChange {
  if (previous == null || previous === 0) return { pct: null, direction: 'flat' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 1) return { pct, direction: 'flat' };
  return { pct, direction: pct > 0 ? 'up' : 'down' };
}
