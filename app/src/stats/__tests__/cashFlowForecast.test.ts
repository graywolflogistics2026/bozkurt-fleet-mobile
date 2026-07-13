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
