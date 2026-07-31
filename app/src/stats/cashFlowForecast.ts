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
export type CashFlowBudgetInputs = {
  bankBalance: number | null;
  weeklyRevenue: number | null;
  truckPayment: number | null;
  fuelWeekly: number | null;
  insuranceMonthly: number | null;
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

export function calcCashFlowForecast(inputs: CashFlowBudgetInputs): CashFlowForecast {
  const b = inputs.bankBalance || 0;
  const wr = inputs.weeklyRevenue || 0;
  const tp = inputs.truckPayment || 0;
  const fu = inputs.fuelWeekly || 0;
  const ins = inputs.insuranceMonthly || 0;
  const oth = inputs.otherWeekly || 0;
  const tx = (inputs.taxReservePct || 0) / 100;

  // Insurance is entered monthly; converted to a weekly figure by /4.33
  // (weeks/month), same constant legacy uses everywhere it converts
  // weekly<->monthly (4.33 = 52/12).
  const wExp = tp + fu + oth + ins / 4.33;
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
