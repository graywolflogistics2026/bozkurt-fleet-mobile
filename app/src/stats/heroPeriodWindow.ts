// CPM/PPM BROKEN AGAIN — ROOT CAUSE FIX (owner decision, device report):
// Home's per-mile trio used to be computed from the FULL, all-time
// account regardless of which Hero Card period tab was active — the
// trio's numerator (revenue/costs) and denominator (miles) were always
// internally consistent with EACH OTHER, but never with the period the
// Hero Card sitting directly above it was actually showing, which is
// why switching "This Week" → "1M" → "Yearly" never moved the trio at
// all, and why an all-time blended average could look implausible next
// to a single week's activity. This is the ONE shared resolver every
// period-aware CPM consumer uses to turn a `HeroPeriod` selection into a
// concrete date window, so "this week"/"last week" here always means the
// EXACT SAME settlement week src/stats/heroPeriod.ts's own
// calcHeroPeriod() resolves them to (both read from the same ascending,
// distinct week_ending list) — never a second, independently-computed
// notion of "this week."
import { HERO_PERIODS, type HeroPeriod } from '@/src/stats/heroPeriod';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';

export type DateWindow = { startIso: string; endIso: string };

const PERIOD_DAYS: Partial<Record<HeroPeriod, number>> = { '1M': 30, '3M': 90, '6M': 180, yearly: 365 };

// `sortedWeekEndings` must be ascending, distinct settlement week_ending
// values (e.g. the weekly true-profit trend's own `.weekEnding` list) —
// the SAME array calcHeroPeriod() itself indexes into for its
// thisWeek/lastWeek tabs. Returns `null` when the window can't be
// resolved (e.g. "This Week" selected on an account with zero
// settlements yet) — callers must treat that as "no data for this
// window," never fall back to an unfiltered/all-time read.
export function resolveHeroPeriodDateWindow(period: HeroPeriod, sortedWeekEndings: string[], now: Date = new Date()): DateWindow | null {
  if (period === 'thisWeek' || period === 'lastWeek') {
    const offset = period === 'thisWeek' ? 0 : 1;
    const index = sortedWeekEndings.length - 1 - offset;
    const weekEnding = sortedWeekEndings[index];
    if (!weekEnding) return null;
    return { startIso: weekStartFromEnding(weekEnding), endIso: weekEnding };
  }
  const days = PERIOD_DAYS[period];
  if (days == null) return null;
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { startIso: start.toISOString().slice(0, 10), endIso: end.toISOString().slice(0, 10) };
}

// The one shared row filter every period-scoped CPM input uses — numerator
// (settlements/deductions/fuel/maintenance/tolls) and denominator (miles,
// via settlements+loads) are ALWAYS filtered through this SAME function
// with the SAME window, so they can never drift onto different date
// ranges from each other.
export function filterRowsByDateWindow<T>(rows: T[], getDate: (row: T) => string | null | undefined, window: DateWindow | null): T[] {
  if (!window) return [];
  return rows.filter((row) => {
    const d = getDate(row);
    return !!d && d >= window.startIso && d <= window.endIso;
  });
}

// Re-exported so callers don't need a second import just to iterate the
// period list.
export { HERO_PERIODS };
export type { HeroPeriod };
