// CASH FLOW — MONTHLY VIEW (owner decision, "period tabs" pass). A
// month-by-month view of the same income/fixed/variable/periodic engine
// the 30-day forecast already uses (cashFlowForecast.ts/
// cashFlowClassification.ts/cashFlowPeriodic.ts) — ACTUAL real dollars
// for a month that's already fully passed, a PROJECTED steady-state
// estimate for a month that hasn't started yet, and a blended
// actual-to-date + projected-remainder figure for the month "today"
// falls inside (never a guess about days that haven't happened, never a
// stale figure for days that have).
import type { CashFlowClassification, SpendEvent } from '@/src/stats/cashFlowClassification';
import type { PeriodicForecastItem } from '@/src/stats/cashFlowPeriodic';
import type { CashFlowOverrides } from '@/src/stats/cashFlowForecast';

export type MonthStatus = 'actual' | 'current' | 'projected';

export type CashFlowMonthProjection = {
  year: number;
  month: number; // 1-12
  status: MonthStatus;
  openingBalance: number;
  income: number;
  fixed: number;
  variable: number;
  periodic: number;
  periodicItems: PeriodicForecastItem[];
  net: number;
  closingBalance: number;
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

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = monthIndex(year, month) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
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

type MonthCore = Omit<CashFlowMonthProjection, 'openingBalance' | 'closingBalance'>;

function computeMonthCore(
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
): MonthCore {
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

// Only the ACTUAL-TO-DATE share of the current month (month start through
// today) — used purely to anchor the balance chain: today's own real
// bank balance already reflects this portion, so it's backed OUT to find
// the month's opening balance, while the full (actual + projected) net
// from computeMonthCore is used going FORWARD from today to find the
// month's closing balance.
function actualToDateNet(
  year: number,
  month: number,
  variableCategories: Set<string>,
  allEvents: SpendEvent[],
  allSettlements: SettlementNetLike[],
  periodicItems: PeriodicForecastItem[],
  overrides: CashFlowOverrides,
  today: Date
): number {
  const { startIso } = monthBoundsIso(year, month);
  const todayIso = today.toISOString().slice(0, 10);
  const income = sumSettlementsNet(allSettlements, startIso, todayIso);
  const { fixed, variable } = sumEventsByBucket(allEvents, startIso, todayIso, variableCategories);
  const { total: periodic } = sumPeriodic(periodicItems, startIso, todayIso, overrides);
  return income - fixed - variable - periodic;
}

// THE ASSEMBLY — 12 months of `year`, with real chained opening/closing
// balances anchored to the ONE true data point available: today's own
// bank balance. Walks outward from the current month (which may or may
// not fall inside the requested `year`) in both directions — backward
// reconstructs past months' balances from real actuals (never a guess),
// forward projects future months from the steady-state weekly figures —
// so a past year's December and next year's January are just as
// correctly chained as the current month itself.
export function buildMonthlyCashFlowOverview(input: {
  year: number;
  todayBalance: number;
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

  function core(y: number, m: number): MonthCore {
    return computeMonthCore(
      y,
      m,
      statusFor(y, m),
      input.weeklyIncome,
      input.weeklyFixed,
      input.weeklyVariable,
      variableCategories,
      input.allEvents,
      input.allSettlements,
      input.periodicItems,
      input.overrides,
      today
    );
  }

  const currentCore = core(currentYear, currentMonth);
  const currentActualToDate = actualToDateNet(
    currentYear,
    currentMonth,
    variableCategories,
    input.allEvents,
    input.allSettlements,
    input.periodicItems,
    input.overrides,
    today
  );
  const currentOpening = input.todayBalance - currentActualToDate;
  const currentClosing = input.todayBalance + (currentCore.net - currentActualToDate);

  const byIndex = new Map<number, CashFlowMonthProjection>();
  byIndex.set(monthIndex(currentYear, currentMonth), { ...currentCore, openingBalance: currentOpening, closingBalance: currentClosing });

  const targetStartIdx = monthIndex(input.year, 1);
  const targetEndIdx = monthIndex(input.year, 12);
  const curIdx = monthIndex(currentYear, currentMonth);

  // Walk forward from the current month through whichever future month
  // the requested year's own December sits at (a no-op loop if the
  // requested year doesn't reach past the current month at all).
  let prevClosing = currentClosing;
  for (let idx = curIdx + 1; idx <= Math.max(targetEndIdx, curIdx); idx++) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const c = core(y, m);
    const opening = prevClosing;
    const closing = opening + c.net;
    byIndex.set(idx, { ...c, openingBalance: opening, closingBalance: closing });
    prevClosing = closing;
  }

  // Walk backward from the current month through whichever past month
  // the requested year's own January sits at.
  let nextOpening = currentOpening;
  for (let idx = curIdx - 1; idx >= Math.min(targetStartIdx, curIdx); idx--) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const c = core(y, m);
    const closing = nextOpening;
    const opening = closing - c.net;
    byIndex.set(idx, { ...c, openingBalance: opening, closingBalance: closing });
    nextOpening = opening;
  }

  const result: CashFlowMonthProjection[] = [];
  for (let m = 1; m <= 12; m++) {
    const entry = byIndex.get(monthIndex(input.year, m));
    if (entry) result.push(entry);
  }
  return result;
}

// "Highlight the tightest and best month" (spec item 3) — lowest and
// highest closing balance across the given months. Returns -1 for an
// empty list rather than throwing.
export function findTightestMonthIndex(months: CashFlowMonthProjection[]): number {
  if (months.length === 0) return -1;
  let idx = 0;
  for (let i = 1; i < months.length; i++) if (months[i].closingBalance < months[idx].closingBalance) idx = i;
  return idx;
}

export function findBestMonthIndex(months: CashFlowMonthProjection[]): number {
  if (months.length === 0) return -1;
  let idx = 0;
  for (let i = 1; i < months.length; i++) if (months[i].closingBalance > months[idx].closingBalance) idx = i;
  return idx;
}
