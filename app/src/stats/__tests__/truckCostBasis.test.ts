import { calcTruckCostBasisWeekly, type TruckCostBasisInput } from '@/src/stats/truckCostBasis';

const base: TruckCostBasisInput = {
  cost_basis_ownership_mode: null,
  purchase_price: null,
  cost_basis_loan_monthly_payment: null,
  cost_basis_paid_spread_months: null,
  cost_basis_warranty_cost: null,
  cost_basis_warranty_term_months: null,
};

describe('calcTruckCostBasisWeekly', () => {
  it('is unconfigured and zero when no ownership mode is set', () => {
    const result = calcTruckCostBasisWeekly(base, false);
    expect(result.isConfigured).toBe(false);
    expect(result.weeklyFixedTotal).toBe(0);
  });

  it('lease mode adds nothing — the settlement withholding already counts it', () => {
    const result = calcTruckCostBasisWeekly({ ...base, cost_basis_ownership_mode: 'lease' }, false);
    expect(result.isConfigured).toBe(true);
    expect(result.weeklyTruckPayment).toBe(0);
  });

  it('loan mode uses the fixed monthly payment, converted to weekly', () => {
    const result = calcTruckCostBasisWeekly(
      { ...base, cost_basis_ownership_mode: 'loan', cost_basis_loan_monthly_payment: 2166.67 },
      false
    );
    expect(result.weeklyTruckPayment).toBeCloseTo((2166.67 * 12) / 52, 2);
  });

  it('loan mode skips its payment when the carrier already withholds it (no double count)', () => {
    const result = calcTruckCostBasisWeekly(
      { ...base, cost_basis_ownership_mode: 'loan', cost_basis_loan_monthly_payment: 2166.67 },
      true
    );
    expect(result.weeklyTruckPayment).toBe(0);
  });

  it('paid mode spreads purchase price over the chosen number of months', () => {
    const result = calcTruckCostBasisWeekly(
      { ...base, cost_basis_ownership_mode: 'paid', purchase_price: 60000, cost_basis_paid_spread_months: 60 },
      false
    );
    // 60000/60 = 1000/mo -> weekly
    expect(result.weeklyTruckPayment).toBeCloseTo((1000 * 12) / 52, 2);
  });

  it('paid mode with no spread months configured stays 0, never a divide-by-zero', () => {
    const result = calcTruckCostBasisWeekly(
      { ...base, cost_basis_ownership_mode: 'paid', purchase_price: 60000, cost_basis_paid_spread_months: null },
      false
    );
    expect(result.weeklyTruckPayment).toBe(0);
    expect(Number.isFinite(result.weeklyFixedTotal)).toBe(true);
  });

  it('adds extended warranty as a separate fixed cost on top of the truck payment', () => {
    const result = calcTruckCostBasisWeekly(
      {
        ...base,
        cost_basis_ownership_mode: 'lease',
        cost_basis_warranty_cost: 3600,
        cost_basis_warranty_term_months: 36,
      },
      false
    );
    expect(result.weeklyTruckPayment).toBe(0);
    expect(result.weeklyWarranty).toBeCloseTo((100 * 12) / 52, 2);
    expect(result.weeklyFixedTotal).toBeCloseTo(result.weeklyWarranty, 5);
  });

  it('sums truck payment and warranty into weeklyFixedTotal', () => {
    const result = calcTruckCostBasisWeekly(
      {
        cost_basis_ownership_mode: 'paid',
        purchase_price: 60000,
        cost_basis_loan_monthly_payment: null,
        cost_basis_paid_spread_months: 60,
        cost_basis_warranty_cost: 3600,
        cost_basis_warranty_term_months: 36,
      },
      false
    );
    expect(result.weeklyFixedTotal).toBeCloseTo(result.weeklyTruckPayment + result.weeklyWarranty, 5);
    expect(result.weeklyFixedTotal).toBeGreaterThan(0);
  });
});
