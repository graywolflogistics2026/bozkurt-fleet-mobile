// Cash Flow's 30-day manual-budget forecast — math ported from legacy
// calcCF() (legacy/index.html:1960), MINUS legacy's own hardcoded
// ||-fallback defaults (truck payment 1145, fuel 1800, other 500, tax
// reserve 25%). Those were the original owner's actual web-app numbers
// baked into the calculation itself — a clean-product bug (owner decision
// 2026-07-30): a brand-new user (or a user who just ran Reset All Data,
// CLAUDE.md invariant #24) would see a "reset" 30-day forecast that still
// silently computed against a stranger's truck payment and fuel budget.
// Every unset input now contributes exactly $0 to the forecast; the tax
// reserve % may be SUGGESTED as 25% in the UI copy, but it is never
// applied to the math unless the user has actually entered a value.
import { reducesTrueProfit } from '@/src/stats/trueProfit';
import { isInsuranceChargeback } from '@/src/import/category';

// CASH FLOW AUTO-FILL FIX (owner decision 2026-08-04, device report: a
// real carrier settlement withholds insurance WEEKLY — bobtail/deadhead,
// physical damage, occupational accident, cargo/workers comp — not as a
// monthly bill). `insuranceMonthly` (§29) is replaced by `insuranceWeekly`
// (docs/PENDING_SQL.md §39) — a new column, not a reinterpretation of the
// old one, so an already-saved monthly figure is never silently misread
// as weekly (a 4.33x error). See trailingWeeklyInsuranceAverage() below
// for how this now auto-fills from the user's own settlement data.
export type CashFlowBudgetInputs = {
  bankBalance: number | null;
  weeklyRevenue: number | null;
  truckPayment: number | null;
  fuelWeekly: number | null;
  insuranceWeekly: number | null;
  otherWeekly: number | null;
  taxReservePct: number | null;
};

export type CashFlowWeek = { week: number; revenue: number; expenses: number; net: number; balance: number };

export type CashFlowForecast = {
  bankBalance: number;
  weeklyExpenses: number;
  weeklyNet: number;
  weeklyTaxReserve: number;
  weeklyNetAfterTax: number;
  revenue30d: number;
  netBalance30d: number;
  weeks: CashFlowWeek[];
};

// DATA-FLOW AUDIT FIX (owner decision 2026-07-30, mega-pass part A —
// known symptom: after a settlement import, Cash Flow revenue stayed $0
// because the forecast's "Weekly Revenue" input has no connection to
// actual settlement data at all, only a manually-typed budget number).
// Trailing 4-week average of ACTUAL settlement gross revenue, grouped by
// week_ending (a multi-truck fleet's same week sums across trucks) —
// used as the forecast's weekly-revenue figure whenever the user hasn't
// entered their own budget number, never persisted over the user's saved
// `null` (see cash-flow.tsx: this is display-only, re-computed live every
// time, so it always reflects the latest imports).
export function trailingWeeklyRevenueAverage(
  settlements: { week_ending: string; gross: number | null }[],
  weeks = 4
): number {
  const byWeek = new Map<string, number>();
  for (const s of settlements) {
    byWeek.set(s.week_ending, (byWeek.get(s.week_ending) ?? 0) + Number(s.gross ?? 0));
  }
  const recentWeeks = [...byWeek.keys()].sort().reverse().slice(0, weeks);
  if (recentWeeks.length === 0) return 0;
  const total = recentWeeks.reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0);
  return total / recentWeeks.length;
}

// CRITICAL BUG FIX (device feedback 2026-07-31, item 3: "Cash Flow shows
// only revenue... none of the settlement's expenses subtracted" —
// settlement-derived expenses must feed the forecast/actuals, not just
// revenue): trailing 28-day average of ACTUAL out-of-pocket fuel cost
// (net of discount), expressed as a weekly figure — same "from your
// settlements" trailing-average pattern as trailingWeeklyRevenueAverage
// above, just for an expense input instead of the revenue one. A 28-day
// window (not "distinct fuel-purchase weeks") is used because fuel rows
// don't carry a week_ending of their own the way settlements do; dividing
// by exactly 4 keeps the result comparable to a weekly budget figure.
export function trailingWeeklyFuelAverage(
  fuelPurchases: { purchase_date: string | null; amount: number | null; discount: number | null }[],
  now: Date = new Date(),
  windowDays = 28
): number {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startIso = start.toISOString().slice(0, 10);
  const total = fuelPurchases
    .filter((f) => (f.purchase_date ?? '') >= startIso)
    .reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);
  return total / (windowDays / 7);
}

// Same pattern for the budget's "Other Weekly" expense input: settlement-
// withheld deductions (fuel advances excepted — those are already counted
// via trailingWeeklyFuelAverage above when the driver ALSO logs pump
// receipts; withheld chargebacks like insurance/ELD/tolls/escrow are not
// otherwise represented anywhere in Cash Flow) plus tolls, using the same
// reducesTrueProfit() rule (src/stats/trueProfit.ts) so a per-diem-covered
// meal or an advance repayment — never a real new expense — isn't counted
// here either. 'Insurance—Truck'/'Insurance—Health'/'Truck/Trailer
// Payments' are ALSO excluded (owner decision 2026-08-04) now that they
// have their own dedicated trailingWeeklyInsuranceAverage()/
// trailingWeeklyTruckPaymentAverage() below — counting them here too
// would double them into both the dedicated field AND "Other Weekly".
const OTHER_EXPENSE_EXCLUDED_CATEGORIES = ['Fuel & DEF', 'Insurance—Truck', 'Insurance—Health', 'Truck/Trailer Payments'];

export function trailingWeeklyOtherExpenseAverage(
  deductions: { ded_date: string | null; amount: number | null; source?: string | null; category?: string | null; tax_deductible: boolean | null }[],
  tolls: { toll_date: string | null; amount: number | null }[],
  now: Date = new Date(),
  windowDays = 28
): number {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startIso = start.toISOString().slice(0, 10);
  const dedTotal = deductions
    .filter((d) => (d.ded_date ?? '') >= startIso && reducesTrueProfit(d) && !OTHER_EXPENSE_EXCLUDED_CATEGORIES.includes(d.category ?? ''))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const tollTotal = tolls
    .filter((t) => (t.toll_date ?? '') >= startIso)
    .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  return (dedTotal + tollTotal) / (windowDays / 7);
}

// Shared by trailingWeeklyInsuranceAverage/trailingWeeklyTruckPaymentAverage
// below — trailing N-week average of SETTLEMENT-WITHHELD deductions
// matching a given predicate, grouped by settlement week_ending (a
// carrier statement arrives once per settlement week, not smoothly every
// 7 days, so grouping by the week the withholding actually happened on —
// same pattern as trailingWeeklyRevenueAverage above — is more accurate
// here than dividing a raw calendar-day window by N/7, which is what
// trailingWeeklyFuelAverage/trailingWeeklyOtherExpenseAverage do instead
// for data that ISN'T tied to a settlement week). Restricted to
// `source === 'settlement'` on purpose: a standalone, out-of-pocket
// insurance/truck-payment expense logged via the Deductions screen
// directly (not withheld from a settlement) is a different thing from
// what this weekly carrier-withholding figure represents.
function trailingWeeklyWithheldAverage(
  deductions: { ded_date: string | null; amount: number | null; source?: string | null; category?: string | null; description?: string | null }[],
  matches: (d: { category?: string | null; description?: string | null }) => boolean,
  weeks = 4
): number {
  const byWeek = new Map<string, number>();
  for (const d of deductions) {
    if (d.source !== 'settlement' || !d.ded_date || !matches(d)) continue;
    byWeek.set(d.ded_date, (byWeek.get(d.ded_date) ?? 0) + Number(d.amount ?? 0));
  }
  const recentWeeks = [...byWeek.keys()].sort().reverse().slice(0, weeks);
  if (recentWeeks.length === 0) return 0;
  const total = recentWeeks.reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0);
  return total / recentWeeks.length;
}

// INSURANCE AUTO-FILL FIX (owner decision 2026-08-04, device report: a
// real carrier settlement withholds FOUR separate insurance charges
// EVERY WEEK — bobtail/deadhead, physical damage, occupational accident,
// cargo/workers comp — not a monthly bill). Category match is the
// primary signal (mapSettlement() already maps all five insurance
// chargebackTypes to 'Insurance—Truck'); isInsuranceChargeback() is a
// text-based fallback catching a row whose category is missing or is
// the settlement schema's own generic "Insurance" string (which does
// NOT match either canonical category) — same "AI classification is
// primary, regex is the safety net" pattern as isEscrowDeposit().
export function trailingWeeklyInsuranceAverage(
  deductions: { ded_date: string | null; amount: number | null; source?: string | null; category?: string | null; description?: string | null }[],
  weeks = 4
): number {
  return trailingWeeklyWithheldAverage(
    deductions,
    (d) => d.category === 'Insurance—Truck' || d.category === 'Insurance—Health' || isInsuranceChargeback(d.description ?? undefined),
    weeks
  );
}

// Same pattern for Truck Payment — settlement-withheld deductions
// categorized 'Truck/Trailer Payments' (chargebackType lease_purchase_
// payment/loan_payment, CHARGEBACK_CATEGORY_LABEL in category.ts).
export function trailingWeeklyTruckPaymentAverage(
  deductions: { ded_date: string | null; amount: number | null; source?: string | null; category?: string | null }[],
  weeks = 4
): number {
  return trailingWeeklyWithheldAverage(deductions, (d) => d.category === 'Truck/Trailer Payments', weeks);
}

// Merges the user's own saved budget inputs with the trailing-average
// fallbacks (owner decision 2026-08-04) — a manual entry always wins and
// is remembered until the user clears it; an empty field falls back to
// the computed average. Extracted as its own pure function (rather than
// inline in the Cash Flow screen) so "a manual override survives
// whatever the averages recompute to" is directly unit-testable without
// mounting the screen.
export type CashFlowAverages = {
  weeklyRevenue: number;
  fuelWeekly: number;
  insuranceWeekly: number;
  truckPayment: number;
  otherWeekly: number;
};

export function mergeForecastInputsWithAverages(base: CashFlowBudgetInputs, averages: CashFlowAverages): CashFlowBudgetInputs {
  return {
    ...base,
    weeklyRevenue: base.weeklyRevenue ?? averages.weeklyRevenue,
    fuelWeekly: base.fuelWeekly ?? averages.fuelWeekly,
    insuranceWeekly: base.insuranceWeekly ?? averages.insuranceWeekly,
    truckPayment: base.truckPayment ?? averages.truckPayment,
    otherWeekly: base.otherWeekly ?? averages.otherWeekly,
  };
}

export function calcCashFlowForecast(inputs: CashFlowBudgetInputs): CashFlowForecast {
  const b = inputs.bankBalance || 0;
  const wr = inputs.weeklyRevenue || 0;
  const tp = inputs.truckPayment || 0;
  const fu = inputs.fuelWeekly || 0;
  const ins = inputs.insuranceWeekly || 0;
  const oth = inputs.otherWeekly || 0;
  const tx = (inputs.taxReservePct || 0) / 100;

  // Insurance is now entered WEEKLY (owner decision 2026-08-04) — no more
  // monthly->weekly /4.33 conversion; it sums into weekly expenses
  // directly, same as every other weekly budget input.
  const wExp = tp + fu + oth + ins;
  const wNet = wr - wExp;
  // Tax Reserve must never go negative (2026-07-30 tablet-testing fix):
  // on a loss week (wNet <= 0) there's no profit to reserve tax against,
  // so taxR clamps to $0 rather than the raw wNet*tx product, which would
  // otherwise be negative and perversely ADD money back into
  // weeklyNetAfterTax below — every downstream figure (the 4-week
  // timeline's running balance, netBalance30d) derives from wNA, so
  // clamping here is the one place that needs to change.
  const taxR = Math.max(0, wNet * tx);
  const wNA = wNet - taxR;
  const r30 = wr * 4.33;
  const n30 = b + wNA * 4.33;

  const weeks: CashFlowWeek[] = [];
  let bal = b;
  for (let i = 1; i <= 4; i++) {
    bal += wNA;
    weeks.push({ week: i, revenue: wr, expenses: wExp, net: wNet, balance: bal });
  }

  return {
    bankBalance: b,
    weeklyExpenses: wExp,
    weeklyNet: wNet,
    weeklyTaxReserve: taxR,
    weeklyNetAfterTax: wNA,
    revenue30d: r30,
    netBalance30d: n30,
    weeks,
  };
}
