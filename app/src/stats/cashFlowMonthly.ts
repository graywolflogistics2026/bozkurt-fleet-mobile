// CASH FLOW — MONTHLY VIEW (owner decision, "period tabs" pass). A
// month-by-month view of the same income/fixed/variable/periodic engine
// the 30-day forecast already uses (cashFlowForecast.ts/
// cashFlowClassification.ts/cashFlowPeriodic.ts) — ACTUAL real dollars
// for a month that's already fully passed, a PROJECTED steady-state
// estimate for a month that hasn't started yet, and a blended
// actual-to-date + projected-remainder figure for the month "today"
// falls inside (never a guess about days that haven't happened, never a
// stale figure for days that have).
//
// REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27): this
// module used to chain opening/closing BALANCES month to month, anchored
// to a single "today's bank balance" input — that whole mechanism is
// gone. Every month is now computed entirely independently (no more
// backward/forward walk needed at all, since nothing carries a running
// total across months anymore) — each month just reports its own
// income/fixed/variable/periodic/net for that month alone.
import type { CashFlowClassification, SpendEvent } from '@/src/stats/cashFlowClassification';
import type { PeriodicForecastItem } from '@/src/stats/cashFlowPeriodic';
import type { CashFlowOverrides } from '@/src/stats/cashFlowForecast';

export type MonthStatus = 'actual' | 'current' | 'projected';

export type CashFlowMonthProjection = {
  year: number;
  month: number; // 1-12
  status: MonthStatus;
  income: number;
  fixed: number;
  variable: number;
  periodic: number;
  periodicItems: PeriodicForecastItem[];
  net: number;
};

type SettlementNetLike = { week_ending: string | null; net: number | null };

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthBoundsIso(year: number, month: number): { startIso: string; endIso: string } {
  const startIso = `${year}-${String(month).padStart(2, '0')}-01`;
  const endIso = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  return { startIso, endIso };
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function sumSettlementsNet(settlements: SettlementNetLike[], startIso: string, endIso: string): number {
  return settlements
    .filter((s) => s.week_ending && s.week_ending >= startIso && s.week_ending <= endIso)
    .reduce((sum, s) => sum + Number(s.net ?? 0), 0);
}

// Buckets ACTUAL spend events by the SAME fixed/variable category sets
// the classifier already determined globally — so "Insurance—Truck"
// reads as fixed in every month's actuals, not just the steady-state
// projection. A category the classifier never bucketed as fixed OR
// variable (typically a one-off, e.g. a $4,800 transmission rebuild) is
// still a REAL expense that happened — unlike the steady-state
// projection (which deliberately excludes one-offs so they don't inflate
// every future week), an ACTUAL month's own total must account for every
// real dollar spent, so an unclassified category folds into "fixed"
// here rather than vanishing from the month's own net.
function sumEventsByBucket(
  events: SpendEvent[],
  startIso: string,
  endIso: string,
  variableCategories: Set<string>
): { fixed: number; variable: number } {
  let fixed = 0;
  let variable = 0;
  for (const e of events) {
    if (!e.date || e.date < startIso || e.date > endIso) continue;
    if (variableCategories.has(e.category)) variable += e.amount;
    else fixed += e.amount;
  }
  return { fixed, variable };
}

function sumPeriodic(
  items: PeriodicForecastItem[],
  startIso: string,
  endIso: string,
  overrides: CashFlowOverrides
): { total: number; items: PeriodicForecastItem[] } {
  const inRange = items.filter((p) => p.dueDate >= startIso && p.dueDate <= endIso);
  const total = inRange.reduce((sum, p) => sum + (overrides.periodicAmounts[p.id] ?? p.amount ?? 0), 0);
  return { total, items: inRange };
}

function computeMonth(
  year: number,
  month: number,
  status: MonthStatus,
  weeklyIncome: number,
  weeklyFixed: number,
  weeklyVariable: number,
  variableCategories: Set<string>,
  allEvents: SpendEvent[],
  allSettlements: SettlementNetLike[],
  periodicItems: PeriodicForecastItem[],
  overrides: CashFlowOverrides,
  today: Date
): CashFlowMonthProjection {
  const { startIso, endIso } = monthBoundsIso(year, month);

  if (status === 'actual') {
    const income = sumSettlementsNet(allSettlements, startIso, endIso);
    const { fixed, variable } = sumEventsByBucket(allEvents, startIso, endIso, variableCategories);
    const { total: periodic, items: periodicItemsInMonth } = sumPeriodic(periodicItems, startIso, endIso, overrides);
    return { year, month, status, income, fixed, variable, periodic, periodicItems: periodicItemsInMonth, net: income - fixed - variable - periodic };
  }

  if (status === 'projected') {
    const weeks = daysInMonth(year, month) / 7;
    const income = weeklyIncome * weeks;
    const fixed = weeklyFixed * weeks;
    const variable = weeklyVariable * weeks;
    const { total: periodic, items: periodicItemsInMonth } = sumPeriodic(periodicItems, startIso, endIso, overrides);
    return { year, month, status, income, fixed, variable, periodic, periodicItems: periodicItemsInMonth, net: income - fixed - variable - periodic };
  }

  // 'current' — actual-to-date (month start through today) blended with
  // a projected remainder (tomorrow through month end). Never guesses at
  // days that haven't happened, never stales out days that already have.
  const todayIso = today.toISOString().slice(0, 10);
  const actualIncome = sumSettlementsNet(allSettlements, startIso, todayIso);
  const actualBuckets = sumEventsByBucket(allEvents, startIso, todayIso, variableCategories);
  const actualPeriodic = sumPeriodic(periodicItems, startIso, todayIso, overrides);

  const remainingDays = Math.max(0, daysInMonth(year, month) - today.getUTCDate());
  const remainderWeeks = remainingDays / 7;
  const projIncome = weeklyIncome * remainderWeeks;
  const projFixed = weeklyFixed * remainderWeeks;
  const projVariable = weeklyVariable * remainderWeeks;
  let remainderPeriodic = { total: 0, items: [] as PeriodicForecastItem[] };
  if (remainingDays > 0) {
    const remainderStartIso = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    remainderPeriodic = sumPeriodic(periodicItems, remainderStartIso, endIso, overrides);
  }

  const income = actualIncome + projIncome;
  const fixed = actualBuckets.fixed + projFixed;
  const variable = actualBuckets.variable + projVariable;
  const periodic = actualPeriodic.total + remainderPeriodic.total;
  const periodicItemsInMonth = [...actualPeriodic.items, ...remainderPeriodic.items];

  return { year, month, status, income, fixed, variable, periodic, periodicItems: periodicItemsInMonth, net: income - fixed - variable - periodic };
}

// THE ASSEMBLY — 12 independent months of `year`. Each month is computed
// entirely on its own (no more balance chain to walk backward/forward for)
// — a past year's December and next year's January are each simply their
// own actual/projected figures, nothing carried between them.
export function buildMonthlyCashFlowOverview(input: {
  year: number;
  weeklyIncome: number;
  weeklyFixed: number;
  weeklyVariable: number;
  classification: CashFlowClassification;
  allEvents: SpendEvent[];
  allSettlements: SettlementNetLike[];
  periodicItems: PeriodicForecastItem[];
  overrides: CashFlowOverrides;
  today?: Date;
}): CashFlowMonthProjection[] {
  const today = input.today ?? new Date();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  const variableCategories = new Set(input.classification.variable.map((v) => v.category));

  function statusFor(y: number, m: number): MonthStatus {
    const idx = monthIndex(y, m);
    const curIdx = monthIndex(currentYear, currentMonth);
    if (idx < curIdx) return 'actual';
    if (idx === curIdx) return 'current';
    return 'projected';
  }

  const result: CashFlowMonthProjection[] = [];
  for (let m = 1; m <= 12; m++) {
    result.push(
      computeMonth(
        input.year,
        m,
        statusFor(input.year, m),
        input.weeklyIncome,
        input.weeklyFixed,
        input.weeklyVariable,
        variableCategories,
        input.allEvents,
        input.allSettlements,
        input.periodicItems,
        input.overrides,
        today
      )
    );
  }
  return result;
}

// "Highlight the tightest and best month" (spec item 3) — lowest and
// highest NET across the given months (no more balance to compute a
// tightest/best POINT from). Returns -1 for an empty list rather than
// throwing.
export function findTightestMonthIndex(months: CashFlowMonthProjection[]): number {
  if (months.length === 0) return -1;
  let idx = 0;
  for (let i = 1; i < months.length; i++) if (months[i].net < months[idx].net) idx = i;
  return idx;
}

export function findBestMonthIndex(months: CashFlowMonthProjection[]): number {
  if (months.length === 0) return -1;
  let idx = 0;
  for (let i = 1; i < months.length; i++) if (months[i].net > months[idx].net) idx = i;
  return idx;
}
