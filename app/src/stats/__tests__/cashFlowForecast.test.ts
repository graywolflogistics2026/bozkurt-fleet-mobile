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

  it('matches the expected math exactly for a full, user-entered set of inputs', () => {
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
