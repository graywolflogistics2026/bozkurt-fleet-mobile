// CASH FLOW FORECAST — BUILT FROM THE USER'S OWN DATA (owner decision,
// binding). The 30-day forecast used to require the user to manually type
// a weekly budget for every line, with an empty screen until they did —
// this module replaces that with a real classifier over the user's own
// trailing 8-12 weeks of settlements/deductions/fuel/maintenance/tolls,
// so a forecast exists the moment settlements exist, with zero manual
// entry required.
//
// Every dollar the user has ever spent falls into exactly one of three
// forecastable behaviours:
//   1. RECURRING FIXED — a charge that shows up in nearly every week at a
//      stable amount (insurance, permits, ELD, occupational accident,
//      truck/lease payment, accounting service, ...). Detected by
//      FREQUENCY + LOW VARIANCE across the observed weeks — never a
//      hardcoded category list, since which categories are "always there"
//      genuinely differs per carrier/owner.
//   2. VARIABLE PER MILE — fuel, maintenance, tolls, fuel additives. These
//      four categories are inherently mileage-driven (the spec's own
//      explicit list) and are never run through the frequency/variance
//      test — their own $/mile rate is computed directly instead.
//   3. ONE-OFF — everything else: a rare or wildly inconsistent charge
//      (a $7,200 extended warranty purchased once) that must NOT be
//      projected forward as if it recurs every week.
export const VARIABLE_PER_MILE_CATEGORIES = ['Fuel & DEF', 'Fuel Additives', 'Maintenance & Repairs', 'Tolls & Scales'] as const;

export type SpendEvent = {
  category: string;
  description: string;
  amount: number;
  date: string | null;
};

export type RecurringFixedCharge = {
  category: string;
  weeklyAmount: number;
  occurrences: number;
};

export type VariableRate = {
  category: string;
  ratePerMile: number;
  totalAmount: number;
};

export type ExcludedOneOff = {
  category: string;
  description: string;
  amount: number;
  date: string | null;
};

export type CashFlowClassification = {
  fixed: RecurringFixedCharge[];
  variable: VariableRate[];
  oneOffs: ExcludedOneOff[];
  weeklyFixedTotal: number;
  // Distinct calendar weeks any spend event (of ANY kind — fixed-
  // candidate or variable) was observed in, within whatever window the
  // caller passed — the real denominator behind "appears in nearly every
  // week," and also the honesty signal for "under 3 weeks of history."
  weeksObserved: number;
};

// A charge must appear in at least this fraction of the observed weeks…
const FIXED_FREQUENCY_THRESHOLD = 0.6;
// …AND its week-to-week amount must be this stable (coefficient of
// variation = stdDev / mean) — a charge that's frequent but wildly
// inconsistent in amount (e.g. ad-hoc "Misc" fees) is not a reliable
// fixed weekly figure to project forward.
const FIXED_VARIANCE_THRESHOLD = 0.25;
// A charge seen only once or twice can never be "recurring," regardless
// of how the frequency ratio happens to work out against a short window.
const MIN_OCCURRENCES_FOR_FIXED = 2;

// Monday-anchored ISO week key ("YYYY-Www") — the one shared "week" unit
// for both settlement-withheld rows (whose date already equals a real
// settlement week_ending) and out-of-pocket rows (which don't carry a
// week_ending at all) so a recurring bill paid either way still groups
// consistently week over week.
export function isoWeekKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO 8601: Thursday of this week determines the week-year; day 0 = Sunday -> 7.
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

// The ONE classification entry point — takes a flat list of spend events
// (already merged from settlement-withheld deductions, out-of-pocket
// deductions, fuel_purchases, maintenance_records, and tolls by the
// caller — see cashFlowForecast.ts's buildSpendEvents()) plus the user's
// own trailing total miles for that same window, and separates it into
// the three forecastable buckets. Groups by the user's own raw category
// string (never resolved to a Schedule C bucket) — a custom category is
// kept as its own distinct recurring-charge line, which is more
// transparent for a weekly cash commitment than folding it into a
// broader tax bucket.
export function classifyCashFlowSpending(events: SpendEvent[], totalMiles: number): CashFlowClassification {
  const realEvents = events.filter((e) => e.amount);

  const allWeekKeys = new Set<string>();
  for (const e of realEvents) {
    const k = isoWeekKey(e.date);
    if (k) allWeekKeys.add(k);
  }
  const weeksObserved = allWeekKeys.size;

  const variableEvents = realEvents.filter((e) => (VARIABLE_PER_MILE_CATEGORIES as readonly string[]).includes(e.category));
  const otherEvents = realEvents.filter((e) => !(VARIABLE_PER_MILE_CATEGORIES as readonly string[]).includes(e.category));

  const variableTotals = new Map<string, number>();
  for (const e of variableEvents) {
    variableTotals.set(e.category, (variableTotals.get(e.category) ?? 0) + e.amount);
  }
  const variable: VariableRate[] = [...variableTotals.entries()]
    .map(([category, totalAmount]) => ({ category, totalAmount, ratePerMile: totalMiles > 0 ? totalAmount / totalMiles : 0 }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // Group the remaining (non-variable) events by category, then by week
  // within that category — a category with 2+ rows landing in the SAME
  // week (e.g. two separate "ELD" line items in one settlement) is
  // collapsed into one weekly figure before the frequency/variance test,
  // so a chatty multi-line category doesn't look artificially "more
  // frequent" than it really is.
  const byCategory = new Map<string, { weekKey: string; amount: number; description: string; date: string | null }[]>();
  for (const e of otherEvents) {
    const k = isoWeekKey(e.date);
    if (!k) continue;
    const category = e.category || 'Misc';
    const arr = byCategory.get(category) ?? [];
    arr.push({ weekKey: k, amount: e.amount, description: e.description, date: e.date });
    byCategory.set(category, arr);
  }

  const fixed: RecurringFixedCharge[] = [];
  const oneOffs: ExcludedOneOff[] = [];

  for (const [category, rows] of byCategory) {
    const perWeek = new Map<string, number>();
    for (const r of rows) perWeek.set(r.weekKey, (perWeek.get(r.weekKey) ?? 0) + r.amount);
    const amounts = [...perWeek.values()];
    const occurrences = amounts.length;
    const frequency = weeksObserved > 0 ? occurrences / weeksObserved : 0;
    const mean = amounts.reduce((s, a) => s + a, 0) / occurrences;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / occurrences;
    const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;

    if (occurrences >= MIN_OCCURRENCES_FOR_FIXED && frequency >= FIXED_FREQUENCY_THRESHOLD && coefficientOfVariation <= FIXED_VARIANCE_THRESHOLD) {
      fixed.push({ category, weeklyAmount: mean, occurrences });
    } else {
      for (const r of rows) oneOffs.push({ category, description: r.description, amount: r.amount, date: r.date });
    }
  }

  const weeklyFixedTotal = fixed.reduce((sum, f) => sum + f.weeklyAmount, 0);

  return {
    fixed: fixed.sort((a, b) => b.weeklyAmount - a.weeklyAmount),
    variable,
    oneOffs: oneOffs.sort((a, b) => b.amount - a.amount),
    weeklyFixedTotal,
    weeksObserved,
  };
}

// Generic "trailing N distinct weeks" average — the SAME averaging
// convention this app has used since the original DATA-FLOW AUDIT FIX
// (CLAUDE.md), now shared by every trailing figure this forecast needs
// (net income, miles): divides by however many distinct weeks were
// ACTUALLY found (never a fixed denominator like 4) — a genuinely light/
// $0 settlement week that DID land still counts as one of the weeks
// (real data, correctly pulls the average down); a week with NO
// settlement at all is simply absent from the map and never assumed to
// be $0, so it can never silently understate the average the way a
// fixed divide-by-4 would.
export function trailingWeeklyAverage<T>(
  rows: T[],
  weekKey: (row: T) => string | null | undefined,
  value: (row: T) => number,
  weeks: number
): { average: number; weeksFound: number; total: number } {
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    const k = weekKey(row);
    if (!k) continue;
    byWeek.set(k, (byWeek.get(k) ?? 0) + value(row));
  }
  const recentWeeks = [...byWeek.keys()].sort().reverse().slice(0, weeks);
  if (recentWeeks.length === 0) return { average: 0, weeksFound: 0, total: 0 };
  const total = recentWeeks.reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0);
  return { average: total / recentWeeks.length, weeksFound: recentWeeks.length, total };
}
