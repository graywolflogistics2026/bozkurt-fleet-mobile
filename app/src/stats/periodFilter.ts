// DEDUCTIONS & SETTLEMENTS — TOTALS + CHARTS (owner decision, "period
// tabs" pass) — the ONE shared period-window definition both the
// Deductions screen and the Settlements screen drive their totals bar,
// chart, and list from, so the two screens can never disagree about what
// "3M" or "YTD" means.
//
// YTD IS CALENDAR-YEAR, NOT ROLLING (CLAUDE.md's own established rule,
// BETA FEEDBACK ROUND item 3 — "matches this calendar year regardless of
// month... not a rolling 365 days"): 'ytd' always means January 1st of
// the CURRENT year through today, exactly like every other YTD figure in
// this app. '3M' is a ROLLING 90-day window (the same convention
// src/stats/heroPeriod.ts already established for its own '3M' tab) —
// deliberately a different kind of window than 'ytd', which is precisely
// the distinction the PER DIEM YTD BUG (this same pass) exists to keep
// straight: a "month" or "rolling" window must never silently collapse
// into the same bucket as a true calendar-year YTD window.
export const PERIOD_OPTIONS = ['thisMonth', '3M', 'ytd', 'all'] as const;
export type PeriodOption = (typeof PERIOD_OPTIONS)[number];

const ROLLING_3M_DAYS = 90;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// The inclusive lower-bound ISO date (YYYY-MM-DD) for a period, or `null`
// for 'all' (no lower bound at all).
export function periodStartIso(period: PeriodOption, now: Date = new Date()): string | null {
  if (period === 'all') return null;
  if (period === 'thisMonth') return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  if (period === 'ytd') return `${now.getFullYear()}-01-01`;
  const d = new Date(now);
  d.setDate(d.getDate() - ROLLING_3M_DAYS);
  return d.toISOString().slice(0, 10);
}

export function filterByPeriod<T>(rows: T[], getDate: (row: T) => string | null | undefined, period: PeriodOption, now: Date = new Date()): T[] {
  const startIso = periodStartIso(period, now);
  if (startIso == null) return rows;
  return rows.filter((row) => {
    const d = getDate(row);
    return !!d && d >= startIso;
  });
}

// CHART BUCKETING (spec item 2c: "weekly buckets for This Month, monthly
// for longer periods") — a longer window bucketed by week would produce
// too many points to read as a trend at a glance; a single month bucketed
// by month would produce exactly one point, which is meaningless (and
// already caught separately by the "fewer than 2 buckets" fallback, spec
// item 2f).
export type BucketGranularity = 'weekly' | 'monthly';

export function bucketGranularityFor(period: PeriodOption): BucketGranularity {
  return period === 'thisMonth' ? 'weekly' : 'monthly';
}
