import {
  calcCashFlowForecast,
  trailingWeeklyRevenueAverage,
  trailingWeeklyInsuranceAverage,
  trailingWeeklyTruckPaymentAverage,
  trailingWeeklyOtherExpenseAverage,
  mergeForecastInputsWithAverages,
  type CashFlowBudgetInputs,
} from '@/src/stats/cashFlowForecast';

function inputs(overrides: Partial<CashFlowBudgetInputs> = {}): CashFlowBudgetInputs {
  return {
    bankBalance: null,
    weeklyRevenue: null,
    truckPayment: null,
    fuelWeekly: null,
    insuranceWeekly: null,
    otherWeekly: null,
    taxReservePct: null,
    ...overrides,
  };
}

describe('calcCashFlowForecast', () => {
  // Clean-product fix (owner decision 2026-07-30): a fresh or freshly-reset
  // profile (CLAUDE.md invariant #24) must show an all-zero forecast, not
  // one silently computed against the original owner's actual budget
  // numbers (truck payment $1145, fuel $1800, other $500, 25% tax reserve).
  it('every unset input contributes $0 — no legacy owner-specific defaults applied', () => {
    const r = calcCashFlowForecast(inputs());
    expect(r.weeklyExpenses).toBe(0);
    expect(r.weeklyNet).toBe(0);
    expect(r.bankBalance).toBe(0);
    expect(r.weeklyTaxReserve).toBe(0);
    expect(r.weeklyNetAfterTax).toBe(0);
    expect(r.revenue30d).toBe(0);
    expect(r.netBalance30d).toBe(0);
    expect(r.weeks.every((w) => w.revenue === 0 && w.expenses === 0 && w.net === 0 && w.balance === 0)).toBe(true);
  });

  it('an explicit 0 for any budget field behaves identically to leaving it unset (no hidden fallback)', () => {
    const r = calcCashFlowForecast(inputs({ truckPayment: 0, fuelWeekly: 0, otherWeekly: 0, taxReservePct: 0 }));
    expect(r.weeklyExpenses).toBe(0);
    expect(r.weeklyTaxReserve).toBe(0);
  });

  it('clamps the tax reserve to $0 on a loss week (net <= 0) instead of going negative', () => {
    const r = calcCashFlowForecast(
      inputs({ bankBalance: 500, weeklyRevenue: 0, truckPayment: 1000, fuelWeekly: 500, otherWeekly: 0, taxReservePct: 30 })
    );
    expect(r.weeklyNet).toBeLessThan(0);
    expect(r.weeklyTaxReserve).toBe(0);
    // Without the clamp this would be wNet - (wNet*0.3), i.e. LESS
    // negative than wNet itself — the bug being fixed.
    expect(r.weeklyNetAfterTax).toBeCloseTo(r.weeklyNet, 5);
    expect(r.weeks.every((w) => w.balance <= 500)).toBe(true);
  });

  it('clamps the tax reserve to exactly $0 (not merely non-negative) when net is exactly 0', () => {
    const r = calcCashFlowForecast(
      inputs({ weeklyRevenue: 2000, truckPayment: 1000, fuelWeekly: 500, otherWeekly: 500, insuranceWeekly: 0, taxReservePct: 25 })
    );
    expect(r.weeklyNet).toBeCloseTo(0, 9);
    expect(r.weeklyTaxReserve).toBe(0);
  });

  it('still reserves a normal positive tax amount on a profitable week (clamp is a no-op there)', () => {
    const r = calcCashFlowForecast(inputs({ weeklyRevenue: 6800, truckPayment: 1145, fuelWeekly: 1800, otherWeekly: 500, taxReservePct: 25 }));
    expect(r.weeklyNet).toBeGreaterThan(0);
    expect(r.weeklyTaxReserve).toBeCloseTo(r.weeklyNet * 0.25, 5);
    expect(r.weeklyTaxReserve).toBeGreaterThan(0);
  });

  it('matches the expected math exactly for a full, user-entered set of inputs', () => {
    const r = calcCashFlowForecast(
      inputs({
        bankBalance: 10000,
        weeklyRevenue: 6800,
        truckPayment: 1145,
        fuelWeekly: 1800,
        // Insurance is entered WEEKLY now (owner decision 2026-08-04) — no
        // more /4.33 monthly->weekly conversion, it sums in directly.
        insuranceWeekly: 100,
        otherWeekly: 500,
        taxReservePct: 25,
      })
    );
    const wExp = 1145 + 1800 + 500 + 100; // 3545
    const wNet = 6800 - wExp;
    const taxR = wNet * 0.25;
    const wNA = wNet - taxR;
    expect(r.weeklyExpenses).toBeCloseTo(wExp, 5);
    expect(r.weeklyNet).toBeCloseTo(wNet, 5);
    expect(r.weeklyTaxReserve).toBeCloseTo(taxR, 5);
    expect(r.revenue30d).toBeCloseTo(6800 * 4.33, 5);
    expect(r.netBalance30d).toBeCloseTo(10000 + wNA * 4.33, 5);
  });

  it('produces a 4-week running balance timeline seeded from bank balance', () => {
    const r = calcCashFlowForecast(inputs({ bankBalance: 1000, weeklyRevenue: 5000, truckPayment: 500, fuelWeekly: 500, otherWeekly: 0.01, taxReservePct: 0.01 }));
    const wExp = 500 + 500 + 0.01;
    const wNet = 5000 - wExp;
    const wNA = wNet - wNet * 0.0001;
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0].balance).toBeCloseTo(1000 + wNA, 5);
    expect(r.weeks[3].balance).toBeCloseTo(1000 + wNA * 4, 5);
    expect(r.weeks.every((w) => w.revenue === 5000 && Math.abs(w.expenses - wExp) < 1e-9)).toBe(true);
  });
});

// DATA-FLOW AUDIT FIX (owner decision 2026-07-30 — known symptom: Cash
// Flow revenue stayed $0 after a settlement import). The forecast's
// Weekly Revenue default when no manual budget is set.
describe('trailingWeeklyRevenueAverage', () => {
  it('is 0 with no settlements', () => {
    expect(trailingWeeklyRevenueAverage([])).toBe(0);
  });

  it('averages the trailing 4 most recent distinct weeks', () => {
    const settlements = [
      { week_ending: '2026-07-05', gross: 1000 },
      { week_ending: '2026-07-12', gross: 2000 },
      { week_ending: '2026-07-19', gross: 3000 },
      { week_ending: '2026-07-26', gross: 4000 },
    ];
    expect(trailingWeeklyRevenueAverage(settlements)).toBe(2500);
  });

  it('ignores weeks older than the trailing window', () => {
    const settlements = [
      { week_ending: '2026-06-01', gross: 100000 }, // way outside the trailing 4
      { week_ending: '2026-07-05', gross: 1000 },
      { week_ending: '2026-07-12', gross: 2000 },
      { week_ending: '2026-07-19', gross: 3000 },
      { week_ending: '2026-07-26', gross: 4000 },
    ];
    expect(trailingWeeklyRevenueAverage(settlements)).toBe(2500);
  });

  it('sums multiple settlements sharing the same week_ending (multi-truck fleet) before averaging', () => {
    const settlements = [
      { week_ending: '2026-07-26', gross: 1000 },
      { week_ending: '2026-07-26', gross: 1500 }, // 2nd truck, same week
    ];
    expect(trailingWeeklyRevenueAverage(settlements)).toBe(2500);
  });

  it('treats a null gross as 0', () => {
    expect(trailingWeeklyRevenueAverage([{ week_ending: '2026-07-26', gross: null }])).toBe(0);
  });
});

// CASH FLOW AUTO-FILL FIX (owner decision 2026-08-04, device report: a
// real carrier settlement withholds FOUR separate insurance charges
// EVERY WEEK — bobtail/deadhead, physical damage, occupational accident,
// cargo/workers comp — while the old "Insurance (mo)" field showed 0 and
// had no connection to actual settlement data at all).
describe('trailingWeeklyInsuranceAverage', () => {
  it('is 0 with no settlements imported yet (clean-product rule — no owner-specific defaults)', () => {
    expect(trailingWeeklyInsuranceAverage([])).toBe(0);
  });

  it('sums all four weekly insurance lines per settlement week, then averages the trailing 4 weeks', () => {
    // Mirrors the device report exactly: 4 separate insurance chargeback
    // lines withheld from EACH week's settlement.
    const deductions = [
      { ded_date: '2026-07-05', amount: 45, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-05', amount: 60, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-05', amount: 20, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-05', amount: 15, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-12', amount: 45, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-12', amount: 60, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-12', amount: 20, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-12', amount: 15, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-19', amount: 140, source: 'settlement', category: 'Insurance—Truck' },
      { ded_date: '2026-07-26', amount: 140, source: 'settlement', category: 'Insurance—Truck' },
    ];
    // Each week totals 140 (45+60+20+15); 4 weeks -> average 140.
    expect(trailingWeeklyInsuranceAverage(deductions)).toBe(140);
  });

  it('catches a row whose category is the settlement schema\'s own generic "Insurance" string via description text', () => {
    const deductions = [
      { ded_date: '2026-07-26', amount: 45, source: 'settlement', category: 'Insurance', description: 'BT/DH INS' },
      { ded_date: '2026-07-26', amount: 60, source: 'settlement', category: 'Insurance', description: 'PHY DAM' },
    ];
    expect(trailingWeeklyInsuranceAverage(deductions)).toBe(105);
  });

  it('ignores Insurance—Health/Truck rows that are NOT settlement-withheld (a standalone out-of-pocket premium is a different thing)', () => {
    const deductions = [{ ded_date: '2026-07-26', amount: 500, source: 'import' as const, category: 'Insurance—Health' }];
    expect(trailingWeeklyInsuranceAverage(deductions)).toBe(0);
  });

  it('ignores unrelated categories', () => {
    const deductions = [{ ded_date: '2026-07-26', amount: 500, source: 'settlement', category: 'Fuel & DEF' }];
    expect(trailingWeeklyInsuranceAverage(deductions)).toBe(0);
  });
});

describe('trailingWeeklyTruckPaymentAverage', () => {
  it('is 0 with no settlements', () => {
    expect(trailingWeeklyTruckPaymentAverage([])).toBe(0);
  });

  it('averages the trailing 4 weeks of Truck/Trailer Payments withholdings', () => {
    const deductions = [
      { ded_date: '2026-07-05', amount: 300, source: 'settlement', category: 'Truck/Trailer Payments' },
      { ded_date: '2026-07-12', amount: 300, source: 'settlement', category: 'Truck/Trailer Payments' },
      { ded_date: '2026-07-19', amount: 300, source: 'settlement', category: 'Truck/Trailer Payments' },
      { ded_date: '2026-07-26', amount: 300, source: 'settlement', category: 'Truck/Trailer Payments' },
    ];
    expect(trailingWeeklyTruckPaymentAverage(deductions)).toBe(300);
  });
});

describe('trailingWeeklyOtherExpenseAverage — no double-counting with the new dedicated averages', () => {
  it('excludes Insurance—Truck/Health and Truck/Trailer Payments now that they have their own dedicated averages', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const deductions = [
      { ded_date: '2026-07-20', amount: 140, source: 'settlement', category: 'Insurance—Truck', tax_deductible: false },
      { ded_date: '2026-07-20', amount: 300, source: 'settlement', category: 'Truck/Trailer Payments', tax_deductible: false },
      { ded_date: '2026-07-20', amount: 45, source: 'settlement', category: 'ELD & Communications', tax_deductible: false },
    ];
    // Only the ELD line should count — insurance/truck-payment are
    // excluded here so they aren't double-counted alongside the new
    // dedicated Insurance/Truck Payment fields.
    expect(trailingWeeklyOtherExpenseAverage(deductions, [], now)).toBeCloseTo(45 / 4, 5);
  });
});

// A manual override must survive whatever the trailing averages
// recompute to after a new settlement import (owner decision 2026-08-04,
// item 2's "stays user-overridable... remembered until cleared").
describe('mergeForecastInputsWithAverages', () => {
  const averages = { weeklyRevenue: 5000, fuelWeekly: 1200, insuranceWeekly: 140, truckPayment: 300, otherWeekly: 200 };

  it('an empty field falls back to the computed average', () => {
    const base: CashFlowBudgetInputs = {
      bankBalance: null,
      weeklyRevenue: null,
      truckPayment: null,
      fuelWeekly: null,
      insuranceWeekly: null,
      otherWeekly: null,
      taxReservePct: null,
    };
    const merged = mergeForecastInputsWithAverages(base, averages);
    expect(merged.weeklyRevenue).toBe(5000);
    expect(merged.insuranceWeekly).toBe(140);
    expect(merged.truckPayment).toBe(300);
  });

  it('a manual override wins and is unaffected by whatever the averages recompute to (survives a new import)', () => {
    const base: CashFlowBudgetInputs = {
      bankBalance: null,
      weeklyRevenue: null,
      truckPayment: null,
      fuelWeekly: null,
      insuranceWeekly: 999, // user's own manually-entered figure
      otherWeekly: null,
      taxReservePct: null,
    };
    // Simulate a new settlement import changing the trailing average —
    // the manual override must still win.
    const recomputedAverages = { ...averages, insuranceWeekly: 250 };
    const merged = mergeForecastInputsWithAverages(base, recomputedAverages);
    expect(merged.insuranceWeekly).toBe(999);
  });

  it('an explicit 0 counts as a real user-entered value, not "empty" (falls back only on null)', () => {
    const base: CashFlowBudgetInputs = {
      bankBalance: null,
      weeklyRevenue: null,
      truckPayment: null,
      fuelWeekly: null,
      insuranceWeekly: 0,
      otherWeekly: null,
      taxReservePct: null,
    };
    expect(mergeForecastInputsWithAverages(base, averages).insuranceWeekly).toBe(0);
  });
});
