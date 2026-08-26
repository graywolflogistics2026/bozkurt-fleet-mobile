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
import { calcWeekOverWeekChange, type WeekOverWeekChange } from '@/src/stats/heroStats';

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

// CPM/PPM BROKEN AGAIN follow-up, item 0 (owner decision) — "the delta
// comparing to the equivalent previous window (previous week for This
// Week, previous month for 1M, and so on)": the companion to
// resolveHeroPeriodDateWindow() above, returning the immediately
// PRECEDING, same-length, non-overlapping window — the settlement week
// right before "this week"/"last week," or the equal-length rolling
// window immediately before the current one for 1M/3M/6M/yearly. `null`
// when it can't be resolved (no settlement that far back yet) — callers
// must treat that as "no comparison available," never a fabricated 0.
export function resolvePreviousHeroPeriodDateWindow(period: HeroPeriod, sortedWeekEndings: string[], now: Date = new Date()): DateWindow | null {
  if (period === 'thisWeek' || period === 'lastWeek') {
    const offset = period === 'thisWeek' ? 1 : 2;
    const index = sortedWeekEndings.length - 1 - offset;
    const weekEnding = sortedWeekEndings[index];
    if (!weekEnding) return null;
    return { startIso: weekStartFromEnding(weekEnding), endIso: weekEnding };
  }
  const days = PERIOD_DAYS[period];
  if (days == null) return null;
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - days);
  // Ends the day BEFORE the current window's own start, so the two
  // windows never overlap on a shared boundary day (filterRowsByDateWindow
  // is inclusive on both ends).
  const prevEnd = new Date(currentStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(currentStart);
  prevStart.setDate(prevStart.getDate() - days);
  return { startIso: prevStart.toISOString().slice(0, 10), endIso: prevEnd.toISOString().slice(0, 10) };
}

type TrioSettlementRow = { week_ending: string | null; gross: number | null };
type TrioDeductionRow = { ded_date: string | null; amount: number | null };

export type HeroRevenueExpenseTrio = {
  window: DateWindow | null;
  revenue: number;
  expenses: number;
  revenueChange: WeekOverWeekChange;
  expensesChange: WeekOverWeekChange;
};

function sumInWindow<T>(
  rows: T[],
  getDate: (row: T) => string | null | undefined,
  getAmount: (row: T) => number | null | undefined,
  window: DateWindow | null
): { total: number; count: number } {
  const filtered = filterRowsByDateWindow(rows, getDate, window);
  return { total: filtered.reduce((sum, row) => sum + Number(getAmount(row) ?? 0), 0), count: filtered.length };
}

// CPM/PPM BROKEN AGAIN follow-up, item 0 (owner decision): the Revenue/
// Expenses/Net Profit trio directly under the Hero Card used to be a
// FIXED "this week vs last week" comparison no matter which period tab
// was selected above it, while everything else on Home (the Hero Card
// itself, the per-mile trio) already followed `heroPeriod` — exactly the
// "two rows on the same screen describe different windows" bug class
// this whole pass exists to catch. Revenue and Expenses are summed
// DIRECTLY from raw settlement/deduction rows (never re-derived from a
// settlement-week-bucketed trend) filtered through the exact same
// `filterRowsByDateWindow()` every other period-scoped figure on this
// screen uses — this is what guarantees the trio's own Expenses number
// always equals the Expense Total Explainer modal's own line-item sum
// for the SAME rows (both read `filterRowsByDateWindow(deductions, ...,
// heroWindow)`), rather than the modal silently covering a different set
// of rows than the tile it opens from. Net Profit is deliberately NOT
// computed here — Home reuses calcHeroPeriod()'s own canonical
// true-profit figure directly, so the trio's Net Profit tile and the
// Hero Card's own headline number are provably the same value, never two
// independently-computed ones that could disagree.
export function calcHeroRevenueExpenseTrio<S extends TrioSettlementRow, D extends TrioDeductionRow>(
  settlements: S[],
  deductions: D[],
  period: HeroPeriod,
  sortedWeekEndings: string[],
  now: Date = new Date()
): HeroRevenueExpenseTrio {
  const window = resolveHeroPeriodDateWindow(period, sortedWeekEndings, now);
  const previousWindow = resolvePreviousHeroPeriodDateWindow(period, sortedWeekEndings, now);
  const currentRevenue = sumInWindow(settlements, (s) => s.week_ending, (s) => s.gross, window);
  const currentExpenses = sumInWindow(deductions, (d) => d.ded_date, (d) => d.amount, window);
  const previousRevenue = sumInWindow(settlements, (s) => s.week_ending, (s) => s.gross, previousWindow);
  const previousExpenses = sumInWindow(deductions, (d) => d.ded_date, (d) => d.amount, previousWindow);
  return {
    window,
    revenue: currentRevenue.total,
    expenses: currentExpenses.total,
    revenueChange: calcWeekOverWeekChange(currentRevenue.total, previousRevenue.count > 0 ? previousRevenue.total : null),
    expensesChange: calcWeekOverWeekChange(currentExpenses.total, previousExpenses.count > 0 ? previousExpenses.total : null),
  };
}

// Re-exported so callers don't need a second import just to iterate the
// period list.
export { HERO_PERIODS };
export type { HeroPeriod };
