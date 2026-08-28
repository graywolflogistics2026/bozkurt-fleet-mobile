// CASH FLOW 30-DAY FORECAST — BUILT FROM THE USER'S OWN DATA (owner
// decision, binding — replaces the earlier manual-budget-entry design in
// full). The forecast used to require the user to type 5 weekly budget
// figures by hand, defaulting to a blank/zero screen until they did, even
// with months of real settlement history already sitting in the account.
// This module now classifies the user's own trailing 8-12 weeks of
// settlements/deductions/fuel/maintenance/tolls (cashFlowClassification.ts)
// and layers in known dated periodic bills from Documents & Renewals
// (cashFlowPeriodic.ts) to produce a real week-by-week projection with NO
// manual entry required — a forecast exists the instant settlements exist.
// Every projected figure can still be overridden (see CashFlowOverrides
// below); an override always wins over the computed figure and persists
// independently of it, so a later import that changes the underlying
// averages can never silently discard a manual correction.
import { reducesTrueProfit } from '@/src/stats/trueProfit';
import {
  classifyCashFlowSpending,
  trailingWeeklyAverage,
  mergeRecurringCharges,
  type CashFlowClassification,
  type SpendEvent,
  type RecurringFixedCharge,
  type RecurringChargeOverride,
} from '@/src/stats/cashFlowClassification';
import { buildPeriodicForecastItems, buildDocumentAmountLookup, type PeriodicForecastItem } from '@/src/stats/cashFlowPeriodic';
import type { ComplianceItem, DocumentRow } from '@/src/types/db';

export {
  classifyCashFlowSpending,
  mergeRecurringCharges,
  VARIABLE_PER_MILE_CATEGORIES,
  isoWeekKey,
  trailingWeeklyAverage,
  type CashFlowClassification,
  type RecurringFixedCharge,
  type RecurringChargeOverride,
  type VariableRate,
  type ExcludedOneOff,
  type SpendEvent,
} from '@/src/stats/cashFlowClassification';
export { buildPeriodicForecastItems, buildPeriodicItemsInRange, buildDocumentAmountLookup, type PeriodicForecastItem } from '@/src/stats/cashFlowPeriodic';

// CLASSIFICATION WINDOW — 12 weeks (spec's own "last 8-12 weeks"). Longer
// than the old engine's 4-week trailing averages on purpose: detecting
// "appears in nearly every week" reliably needs more history than 4 data
// points can honestly support — a charge seen in 3 of 4 weeks LOOKS
// "recurring" by pure chance far more easily than one seen in 8 of 12.
const CLASSIFICATION_WINDOW_WEEKS = 12;
const INCOME_WINDOW_WEEKS = 4;
// Below this many distinct settlement weeks, the forecast is shown but
// flagged unreliable (spec item 5, HONESTY) rather than hidden — "show
// what IS known rather than nothing."
const RELIABLE_HISTORY_WEEKS = 3;
const FORECAST_WEEKS = 4;

type DeductionLike = {
  ded_date: string | null;
  amount: number | null;
  category: string | null;
  description: string | null;
  source?: string | null;
  tax_deductible: boolean | null;
};
type FuelLike = { purchase_date: string | null; amount: number | null; discount: number | null; location?: string | null; settlement_id?: string | null };
type MaintenanceLike = { service_date: string | null; cost: number | null; description?: string | null; service_type?: string | null };
type TollLike = { toll_date: string | null; amount: number | null; plaza?: string | null };
type SettlementLike = { week_ending: string | null; gross: number | null; net: number | null; miles: number | null };
type ReimbursementLike = { reimb_date: string | null; amount: number | null };

// Merges deductions/fuel/maintenance/tolls into one flat list of spend
// events for the classifier — window-filtered here (not by the caller)
// so every consumer of this module filters the exact same way. Excludes
// Meals/Advance Repayment/Escrow (reducesTrueProfit — never a real cash
// outflow to project) and settlement-linked fuel_purchases rows (their
// cost is already represented by that settlement's own withheld fuel
// deduction line — same canonical-expense-engine double-count guard
// trueProfit.ts's sumCanonicalExpenses() already established; maintenance/
// tolls have no equivalent settlement_id to guard, same precedent).
export function buildSpendEvents(
  deductions: DeductionLike[],
  fuelPurchases: FuelLike[],
  maintenanceRecords: MaintenanceLike[],
  tolls: TollLike[],
  windowStartIso: string
): SpendEvent[] {
  const events: SpendEvent[] = [];

  for (const d of deductions) {
    if (!d.ded_date || d.ded_date < windowStartIso) continue;
    const amount = Number(d.amount ?? 0);
    if (!amount || !reducesTrueProfit(d)) continue;
    events.push({ category: d.category ?? 'Misc', description: d.description || d.category || 'Deduction', amount, date: d.ded_date });
  }
  for (const f of fuelPurchases) {
    if (f.settlement_id) continue;
    if (!f.purchase_date || f.purchase_date < windowStartIso) continue;
    const amount = Math.max(0, Number(f.amount ?? 0) - Number(f.discount ?? 0));
    if (!amount) continue;
    events.push({ category: 'Fuel & DEF', description: f.location || 'Fuel', amount, date: f.purchase_date });
  }
  for (const m of maintenanceRecords) {
    if (!m.service_date || m.service_date < windowStartIso) continue;
    const amount = Number(m.cost ?? 0);
    if (!amount) continue;
    events.push({ category: 'Maintenance & Repairs', description: m.description || m.service_type || 'Maintenance', amount, date: m.service_date });
  }
  for (const t of tolls) {
    if (!t.toll_date || t.toll_date < windowStartIso) continue;
    const amount = Number(t.amount ?? 0);
    if (!amount) continue;
    events.push({ category: 'Tolls & Scales', description: t.plaza || 'Toll', amount, date: t.toll_date });
  }
  return events;
}

// INCOME (spec item 2) — trailing 4-week average of ACTUAL net settlement
// pay, divided by however many distinct settlement weeks were actually
// found (trailingWeeklyAverage's own convention) — a real $0/low "home
// week" settlement that DID land still counts as one of the weeks
// (correctly pulls the average down); a week with no settlement at all
// is simply absent, never assumed to be $0, so it can never silently
// halve the average the way a fixed divide-by-4 would.
export function trailingWeeklyNetIncomeAverage(settlements: SettlementLike[], weeks = INCOME_WINDOW_WEEKS): { average: number; weeksFound: number; total: number } {
  return trailingWeeklyAverage(settlements, (s) => s.week_ending, (s) => Number(s.net ?? 0), weeks);
}

export function trailingWeeklyMilesAverage(settlements: SettlementLike[], weeks = INCOME_WINDOW_WEEKS): { average: number; weeksFound: number; total: number } {
  return trailingWeeklyAverage(settlements, (s) => s.week_ending, (s) => Number(s.miles ?? 0), weeks);
}

// "plus recorded upcoming reimbursements" (spec item 2) — any
// reimbursement already on file dated within the forecast window itself
// (today through today+30), summed and added to that specific week's
// income rather than smoothed into the weekly average (a reimbursement
// is a one-time, dated event, not a recurring rate).
export function upcomingReimbursementsByWeek(
  reimbursements: ReimbursementLike[],
  today: Date,
  windowDays = FORECAST_WEEKS * 7
): Map<number, number> {
  const todayIso = today.toISOString().slice(0, 10);
  const endIso = new Date(today.getTime() + windowDays * 86400000).toISOString().slice(0, 10);
  const byWeekIndex = new Map<number, number>();
  for (const r of reimbursements) {
    if (!r.reimb_date || r.reimb_date < todayIso || r.reimb_date > endIso) continue;
    const amount = Number(r.amount ?? 0);
    if (!amount) continue;
    const daysOut = Math.floor((new Date(`${r.reimb_date}T00:00:00Z`).getTime() - new Date(`${todayIso}T00:00:00Z`).getTime()) / 86400000);
    const weekIndex = Math.min(FORECAST_WEEKS - 1, Math.floor(daysOut / 7));
    byWeekIndex.set(weekIndex, (byWeekIndex.get(weekIndex) ?? 0) + amount);
  }
  return byWeekIndex;
}

export type CashFlowOverrides = {
  incomeWeekly: number | null;
  fixedWeekly: number | null;
  variableWeekly: number | null;
  // complianceItemId -> overridden dollar amount for that one periodic item.
  periodicAmounts: Record<string, number>;
  // SHOW AND LET ME CORRECT IT (owner decision) — category -> the user's
  // own correction (an edited amount, a removal, or a brand-new manually-
  // added recurring charge the classifier never detected). Always wins
  // per-category over what classifyCashFlowSpending() itself detected —
  // "detection is a convenience, not a cage." Independent of
  // `fixedWeekly` above (the older, coarser "override the WHOLE weekly
  // total" lever, kept unchanged and still wins for the actual forecast
  // math when set — see buildCashFlowForecast()'s own comment).
  recurringCharges: Record<string, RecurringChargeOverride>;
};

export const EMPTY_CASH_FLOW_OVERRIDES: CashFlowOverrides = {
  incomeWeekly: null,
  fixedWeekly: null,
  variableWeekly: null,
  periodicAmounts: {},
  recurringCharges: {},
};

export type CashFlowWeekProjection = {
  weekIndex: number; // 0-based
  startDate: string;
  endDate: string;
  income: number;
  fixed: number;
  variable: number;
  periodic: number;
  periodicItems: PeriodicForecastItem[];
  // REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — the
  // forecast no longer assumes an opening bank balance at all (the user's
  // own real bank balance is the source of truth, not an app estimate
  // this app has repeatedly gotten wrong). `net` is simply this week's
  // own income minus its own fixed/variable/periodic outflows — a
  // per-period figure, never a running total.
  net: number;
};

export type CashFlowForecastResult = {
  weeks: CashFlowWeekProjection[];
  // "Tightest point" is now the period with the WEAKEST NET (the lowest
  // income-minus-expenses week), never a running/ending balance — there
  // is no more balance to compute. Renamed from the old tightestWeekIndex
  // (which used to mean "lowest ending balance") to make the new meaning
  // unambiguous at every call site.
  weakestWeekIndex: number;
  weeksOfHistory: number;
  reliable: boolean;
  classification: CashFlowClassification;
  // SHOW AND LET ME CORRECT IT (owner decision) — classification.fixed
  // PLUS every user correction (mergeRecurringCharges()) — this is the
  // list the screen actually renders/edits, never the raw
  // classification.fixed alone (which reflects the classifier's own
  // opinion only, before "not a cage" corrections are applied).
  fixedCharges: RecurringFixedCharge[];
  // The steady-state weekly figures actually used (post-override) — the
  // screen builds its "avg of last N weeks" / "$X/mi × Y mi" basis
  // captions from these plus the raw classification/income data above,
  // via t() (this module never touches i18n itself).
  weeklyIncome: number;
  weeklyFixed: number;
  weeklyVariable: number;
  incomeIsOverridden: boolean;
  fixedIsOverridden: boolean;
  variableIsOverridden: boolean;
  incomeWeeksFound: number;
  variableRatePerMile: number;
  variableMilesAvg: number;
};

// THE ASSEMBLY (spec item 3) — one income/fixed/variable/periodic/net row
// per week, for FORECAST_WEEKS weeks starting today (not calendar-Monday-
// aligned — "30 days from now," matching the screen's own existing
// "30-Day Forecast" framing). A periodic item lands in whichever week's
// [startDate, endDate] range contains its own due_date; everything else
// (income/fixed/variable) is the SAME steady-state weekly figure repeated
// across every week. REMOVE BUSINESS BALANCE TRACKING (owner decision
// 2026-08-27): no opening/closing balance is computed anymore — the
// forecast projects each week's own net (income minus that week's own
// outflows) independently, never a running total.
export function buildCashFlowForecast(
  incomeAvg: { average: number; weeksFound: number },
  classification: CashFlowClassification,
  milesAvg: { average: number; weeksFound: number },
  periodicItems: PeriodicForecastItem[],
  reimbursementsByWeek: Map<number, number>,
  overrides: CashFlowOverrides,
  today: Date = new Date()
): CashFlowForecastResult {
  const variableRatePerMile = classification.variable.reduce((sum, v) => sum + v.ratePerMile, 0);
  const computedVariable = variableRatePerMile * milesAvg.average;

  // SHOW AND LET ME CORRECT IT (owner decision) — every detected recurring
  // charge PLUS the user's own corrections (an edited amount, a removal,
  // or a brand-new manually-added charge the classifier never detected).
  // `overrides.fixedWeekly` (the older, coarser "override the WHOLE
  // weekly total" lever) still wins over BOTH when set, unchanged — but
  // the default (no whole-total override) now sums the merged per-charge
  // list instead of the classifier's own raw, uncorrected total, so a
  // correction actually changes the projected weekly figure.
  const fixedCharges = mergeRecurringCharges(classification.fixed, overrides.recurringCharges);
  const mergedFixedTotal = fixedCharges.reduce((sum, f) => sum + f.weeklyAmount, 0);

  const weeklyIncome = overrides.incomeWeekly ?? incomeAvg.average;
  const weeklyFixed = overrides.fixedWeekly ?? mergedFixedTotal;
  const weeklyVariable = overrides.variableWeekly ?? computedVariable;

  const todayIso = today.toISOString().slice(0, 10);
  const weeks: CashFlowWeekProjection[] = [];

  for (let i = 0; i < FORECAST_WEEKS; i++) {
    const start = new Date(today.getTime() + i * 7 * 86400000);
    const end = new Date(today.getTime() + (i * 7 + 6) * 86400000);
    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);

    const weekPeriodicItems = periodicItems.filter((p) => p.dueDate >= startIso && p.dueDate <= endIso);
    const periodicTotal = weekPeriodicItems.reduce((sum, p) => sum + (overrides.periodicAmounts[p.id] ?? p.amount ?? 0), 0);
    const reimbursementThisWeek = reimbursementsByWeek.get(i) ?? 0;

    const incomeThisWeek = weeklyIncome + reimbursementThisWeek;
    const net = incomeThisWeek - weeklyFixed - weeklyVariable - periodicTotal;

    weeks.push({
      weekIndex: i,
      startDate: startIso,
      endDate: endIso,
      income: incomeThisWeek,
      fixed: weeklyFixed,
      variable: weeklyVariable,
      periodic: periodicTotal,
      periodicItems: weekPeriodicItems,
      net,
    });
  }

  let weakestWeekIndex = 0;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].net < weeks[weakestWeekIndex].net) weakestWeekIndex = i;
  }

  const weeksOfHistory = Math.max(incomeAvg.weeksFound, classification.weeksObserved);

  return {
    weeks,
    weakestWeekIndex,
    weeksOfHistory,
    reliable: weeksOfHistory >= RELIABLE_HISTORY_WEEKS,
    classification,
    fixedCharges,
    weeklyIncome,
    weeklyFixed,
    weeklyVariable,
    incomeIsOverridden: overrides.incomeWeekly != null,
    fixedIsOverridden: overrides.fixedWeekly != null,
    variableIsOverridden: overrides.variableWeekly != null,
    incomeWeeksFound: incomeAvg.weeksFound,
    variableRatePerMile,
    variableMilesAvg: milesAvg.average,
  };
}

// ONE end-to-end entry point the screen calls with raw query data —
// bundles buildSpendEvents/classifyCashFlowSpending/trailing averages/
// buildPeriodicForecastItems/buildCashFlowForecast so the screen itself
// never has to get the plumbing order right on its own, and so this
// exact pipeline is what the "realistic dataset" tests exercise end to
// end (never just one function in isolation).
export function buildCashFlowForecastFromData(input: {
  settlements: SettlementLike[];
  deductions: DeductionLike[];
  fuelPurchases: FuelLike[];
  maintenanceRecords: MaintenanceLike[];
  tolls: TollLike[];
  reimbursements: ReimbursementLike[];
  complianceItems: Pick<ComplianceItem, 'id' | 'type' | 'label' | 'due_date' | 'source_document_id'>[];
  documents: Pick<DocumentRow, 'id' | 'amount'>[];
  overrides: CashFlowOverrides;
  today?: Date;
}): CashFlowForecastResult {
  const today = input.today ?? new Date();
  const windowStart = new Date(today.getTime() - CLASSIFICATION_WINDOW_WEEKS * 7 * 86400000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  const events = buildSpendEvents(input.deductions, input.fuelPurchases, input.maintenanceRecords, input.tolls, windowStartIso);
  const windowedSettlements = input.settlements.filter((s) => (s.week_ending ?? '') >= windowStartIso);
  const classificationWindowMiles = trailingWeeklyMilesAverage(windowedSettlements, CLASSIFICATION_WINDOW_WEEKS);
  const classification = classifyCashFlowSpending(events, classificationWindowMiles.total);

  const incomeAvg = trailingWeeklyNetIncomeAverage(input.settlements, INCOME_WINDOW_WEEKS);
  const incomeMilesAvg = trailingWeeklyMilesAverage(input.settlements, INCOME_WINDOW_WEEKS);
  const periodicItems = buildPeriodicForecastItems(input.complianceItems, buildDocumentAmountLookup(input.documents), today);
  const reimbursementsByWeek = upcomingReimbursementsByWeek(input.reimbursements, today);

  return buildCashFlowForecast(
    incomeAvg,
    classification,
    { average: incomeMilesAvg.average, weeksFound: incomeMilesAvg.weeksFound },
    periodicItems,
    reimbursementsByWeek,
    input.overrides,
    today
  );
}
