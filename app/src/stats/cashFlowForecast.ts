// Cash Flow's 30-day manual-budget forecast — verbatim port of legacy
// calcCF() (legacy/index.html:1960). Legacy's own form fields have no
// persistence (recomputed on every oninput); the ||-fallback defaults
// below (including the "0 is treated as unset" quirk that gives an
// explicit 0 truck payment back its 1145 default) are ported as-is
// rather than "fixed," since this is existing, tested legacy behavior,
// not a bug (FEATURE_INVENTORY.md §4 lists no issue with it).
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

export function calcCashFlowForecast(inputs: CashFlowBudgetInputs): CashFlowForecast {
  const b = inputs.bankBalance || 0;
  const wr = inputs.weeklyRevenue || 0;
  const tp = inputs.truckPayment || 1145;
  const fu = inputs.fuelWeekly || 1800;
  const ins = inputs.insuranceMonthly || 0;
  const oth = inputs.otherWeekly || 500;
  const tx = (inputs.taxReservePct || 25) / 100;

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
