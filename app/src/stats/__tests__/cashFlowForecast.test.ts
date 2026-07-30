import { calcCashFlowForecast, type CashFlowBudgetInputs } from '@/src/stats/cashFlowForecast';

function inputs(overrides: Partial<CashFlowBudgetInputs> = {}): CashFlowBudgetInputs {
  return {
    bankBalance: null,
    weeklyRevenue: null,
    truckPayment: null,
    fuelWeekly: null,
    insuranceMonthly: null,
    otherWeekly: null,
    taxReservePct: null,
    ...overrides,
  };
}

describe('calcCashFlowForecast', () => {
  it('applies legacy default placeholders when every input is null', () => {
    const r = calcCashFlowForecast(inputs());
    // wExp = 1145 + 1800 + 500 + 0/4.33 = 3445; wr = 0 -> wNet = -3445
    expect(r.weeklyExpenses).toBeCloseTo(3445, 5);
    expect(r.weeklyNet).toBeCloseTo(-3445, 5);
    expect(r.bankBalance).toBe(0);
    // 2026-07-30 fix: a loss week reserves $0 tax, never a negative
    // number added back into the net-after-tax figure.
    expect(r.weeklyTaxReserve).toBe(0);
    expect(r.weeklyNetAfterTax).toBeCloseTo(-3445, 5);
  });

  it('clamps the tax reserve to $0 on a loss week (net <= 0) instead of going negative', () => {
    // Same shape as the null-inputs case but with an explicit revenue of 0
    // and a non-default tax %, to isolate the clamp from the ||-default
    // quirks exercised elsewhere in this file.
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
    // otherWeekly must be non-zero (an explicit 0 falls back to the
    // legacy 500 default, same quirk covered elsewhere in this file) —
    // 1000+500+500 of expenses against 2000 revenue nets exactly to 0.
    const r = calcCashFlowForecast(
      inputs({ weeklyRevenue: 2000, truckPayment: 1000, fuelWeekly: 500, otherWeekly: 500, insuranceMonthly: 0, taxReservePct: 25 })
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

  it('matches legacy calcCF() math exactly for a full set of inputs', () => {
    const r = calcCashFlowForecast(
      inputs({
        bankBalance: 10000,
        weeklyRevenue: 6800,
        truckPayment: 1145,
        fuelWeekly: 1800,
        insuranceMonthly: 433, // 100/wk after /4.33
        otherWeekly: 500,
        taxReservePct: 25,
      })
    );
    const wExp = 1145 + 1800 + 500 + 433 / 4.33; // 3545
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
    // taxReservePct:0 would hit the same ||-default quirk as truck payment
    // (0 is falsy -> falls back to 25%), so use a small non-zero value to
    // keep this test's arithmetic simple and unambiguous.
    const r = calcCashFlowForecast(inputs({ bankBalance: 1000, weeklyRevenue: 5000, truckPayment: 500, fuelWeekly: 500, otherWeekly: 0.01, taxReservePct: 0.01 }));
    const wExp = 500 + 500 + 0.01;
    const wNet = 5000 - wExp;
    const wNA = wNet - wNet * 0.0001;
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0].balance).toBeCloseTo(1000 + wNA, 5);
    expect(r.weeks[3].balance).toBeCloseTo(1000 + wNA * 4, 5);
    expect(r.weeks.every((w) => w.revenue === 5000 && Math.abs(w.expenses - wExp) < 1e-9)).toBe(true);
  });

  it('treats an explicit 0 truck payment as unset (legacy ||-default quirk, ported as-is)', () => {
    const r = calcCashFlowForecast(inputs({ truckPayment: 0 }));
    expect(r.weeklyExpenses).toBeCloseTo(1145 + 1800 + 500, 5);
  });
});
