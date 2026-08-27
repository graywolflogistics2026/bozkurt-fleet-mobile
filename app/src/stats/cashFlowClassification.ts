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
  // SHOW AND LET ME CORRECT IT (owner decision) — 'auto' = the classifier
  // itself detected this category; 'manual' = the user added it (a
  // category the classifier never detected on its own) or edited its
  // amount (still tagged 'auto' — the OCCURRENCES/detection itself is
  // still real, only the dollar amount was corrected). See
  // mergeRecurringCharges() below for how a manual override interacts
  // with what the classifier detects on a later re-import.
  source: 'auto' | 'manual';
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

// THRESHOLDS TOO STRICT FOR A YOUNG ACCOUNT (owner decision, device
// report: "Fixed expenses $0 · 0 recurring charges detected" despite
// real weekly Insurance/Permits/ELD chargebacks in every settlement).
// Instrumented against a realistic 6-settlement dataset before touching
// anything (see CLAUDE.md's own dated entry for this pass for the full
// diagnostic transcript): a PERFECTLY clean 6/6-occurrence case already
// passed under the OLD thresholds — the actual failure mode is a
// PARTIALLY noisy but still genuinely recurring charge (a category that
// only resolves correctly in 3-4 of a young account's 6 real weeks, e.g.
// due to OCR/text variance in how a carrier's own chargeback line reads
// week to week) getting held to the SAME 60%-of-weeks ratio a
// long-established account is held to — a ratio that's statistically
// far too strict to be meaningful over only a handful of data points.
// requiredOccurrencesFor() replaces the old flat `frequency >=
// FIXED_FREQUENCY_THRESHOLD` + `occurrences >= MIN_OCCURRENCES_FOR_FIXED`
// pair with ONE scaled occurrence floor: below YOUNG_ACCOUNT_WEEKS worth
// of history, 3 occurrences is enough, full stop — no ratio test at all,
// since a ratio isn't a meaningful signal yet. At or above that, it
// converges back to (an occurrence-equivalent form of) the original 60%
// ratio, so an established account's own behavior is unchanged.
const YOUNG_ACCOUNT_WEEKS = 6;
const YOUNG_ACCOUNT_MIN_OCCURRENCES = 3;
// A charge seen only ONCE can never be "recurring," full stop, no matter
// how few weeks of history exist (a single random fee trivially "occurs
// in 100% of the 1 week observed so far" — this absolute floor is what
// still rejects that, regardless of the young-account relaxation above).
const ABSOLUTE_MIN_OCCURRENCES = 2;
const FIXED_FREQUENCY_THRESHOLD = 0.6;
// A charge's week-to-week amount must be this stable (coefficient of
// variation = stdDev / mean) to be treated as a reliable fixed weekly
// figure — a charge that's frequent but wildly inconsistent in amount
// (e.g. ad-hoc "Misc" fees) should not be projected forward as if it
// recurs at one fixed rate. Deliberately loose enough that real-world
// minor variation (e.g. $30.43 / $30.43 / $29.99, CV ≈ 0.7%) always
// qualifies with enormous headroom to spare.
const FIXED_VARIANCE_THRESHOLD = 0.25;

export function requiredOccurrencesFor(weeksObserved: number): number {
  if (weeksObserved <= YOUNG_ACCOUNT_WEEKS) return Math.max(ABSOLUTE_MIN_OCCURRENCES, Math.min(YOUNG_ACCOUNT_MIN_OCCURRENCES, weeksObserved));
  return Math.max(YOUNG_ACCOUNT_MIN_OCCURRENCES, Math.ceil(weeksObserved * FIXED_FREQUENCY_THRESHOLD));
}

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

  const requiredOccurrences = requiredOccurrencesFor(weeksObserved);
  for (const [category, rows] of byCategory) {
    const perWeek = new Map<string, number>();
    for (const r of rows) perWeek.set(r.weekKey, (perWeek.get(r.weekKey) ?? 0) + r.amount);
    const amounts = [...perWeek.values()];
    const occurrences = amounts.length;
    const mean = amounts.reduce((s, a) => s + a, 0) / occurrences;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / occurrences;
    const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;

    if (occurrences >= requiredOccurrences && coefficientOfVariation <= FIXED_VARIANCE_THRESHOLD) {
      fixed.push({ category, weeklyAmount: mean, occurrences, source: 'auto' });
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

// SHOW AND LET ME CORRECT IT (owner decision) — "detection is a
// convenience, not a cage." Every detected recurring charge, plus every
// user correction (an edited amount, a removal, or a brand-new charge
// the classifier never detected on its own), keyed by category string —
// the SAME key `profiles.cf_recurring_charges` (docs/PENDING_SQL.md §66)
// persists, so a correction survives the next re-classification of the
// same category untouched, exactly like `cf_periodic_overrides` (§57)
// already does for periodic items. Pure and independently testable from
// the classifier itself, on purpose — the classifier's job is detection,
// this function's job is "detection plus the user's own last word."
export type RecurringChargeOverride = { weeklyAmount: number; removed?: boolean };

export function mergeRecurringCharges(
  detected: RecurringFixedCharge[],
  overrides: Record<string, RecurringChargeOverride>
): RecurringFixedCharge[] {
  const merged: RecurringFixedCharge[] = [];
  const detectedCategories = new Set(detected.map((f) => f.category));

  for (const charge of detected) {
    const override = overrides[charge.category];
    if (override?.removed) continue;
    merged.push(override ? { ...charge, weeklyAmount: override.weeklyAmount } : charge);
  }

  // Any override for a category the classifier never detected at all is
  // a brand-new, user-added recurring charge — "add a recurring charge
  // for anything missed" (owner decision). `occurrences: 0` is what
  // distinguishes a manual addition from something the classifier itself
  // ever observed, for a caller that wants to say so explicitly.
  for (const [category, override] of Object.entries(overrides)) {
    if (detectedCategories.has(category) || override.removed) continue;
    merged.push({ category, weeklyAmount: override.weeklyAmount, occurrences: 0, source: 'manual' });
  }

  return merged.sort((a, b) => b.weeklyAmount - a.weeklyAmount);
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
