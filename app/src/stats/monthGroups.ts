// BETA FEEDBACK ROUND (owner decision 2026-07-31, device tester report):
// every long chronological list (Settlements, Reimbursements, Deductions,
// Fuel, Tolls, Loads, Other Income, Documents, ...) gets collapsible
// month sections instead of one flat scroll. This is the one shared, pure
// bucketing function every list screen's grouping derives from — "date
// bucketing" is exactly the kind of logic CLAUDE.md's "every calculation
// is a tested app/src function" pattern exists for.
export type MonthGroup<T> = {
  // "YYYY-MM", or 'unknown' for a row with no parseable date — rows
  // never get silently dropped just because a date is missing.
  monthKey: string;
  count: number;
  total: number;
  rows: T[];
};

export const UNKNOWN_MONTH_KEY = 'unknown';

function monthKeyFor(dateStr: string | null | undefined): string {
  if (!dateStr) return UNKNOWN_MONTH_KEY;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return UNKNOWN_MONTH_KEY;
  return dateStr.slice(0, 7);
}

// Groups already-any-order rows by calendar month (YYYY-MM), summing
// `getAmount` per month and preserving each row's relative order within
// its own month. Sorted descending by monthKey (most recent first),
// with the 'unknown' bucket (no date) always last — it's the one bucket
// that can't be meaningfully placed in chronological order.
export function groupByMonth<T>(
  rows: T[],
  getDate: (row: T) => string | null | undefined,
  getAmount: (row: T) => number
): MonthGroup<T>[] {
  const byMonth = new Map<string, MonthGroup<T>>();
  for (const row of rows) {
    const monthKey = monthKeyFor(getDate(row));
    let group = byMonth.get(monthKey);
    if (!group) {
      group = { monthKey, count: 0, total: 0, rows: [] };
      byMonth.set(monthKey, group);
    }
    group.count += 1;
    group.total += Number(getAmount(row) ?? 0);
    group.rows.push(row);
  }
  return [...byMonth.values()].sort((a, b) => {
    if (a.monthKey === UNKNOWN_MONTH_KEY) return 1;
    if (b.monthKey === UNKNOWN_MONTH_KEY) return -1;
    return b.monthKey.localeCompare(a.monthKey);
  });
}

export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}
