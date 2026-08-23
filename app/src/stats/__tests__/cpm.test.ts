import { calcCpm, calcCanonicalCpm, normalizeToWeeklyPayment, ppmColor } from '@/src/stats/cpm';

describe('calcCpm', () => {
  it('computes revenue/cost/profit per mile', () => {
    const result = calcCpm(200000, 150000, 100000);
    expect(result.revenuePerMile).toBeCloseTo(2.0, 5);
    expect(result.costPerMile).toBeCloseTo(1.5, 5);
    expect(result.profitPerMile).toBeCloseTo(0.5, 5);
  });

  it('returns nulls when there are no miles (avoids divide-by-zero)', () => {
    expect(calcCpm(50000, 20000, 0)).toEqual({ revenuePerMile: null, costPerMile: null, profitPerMile: null });
  });
});

describe('calcCanonicalCpm (owner decision 2026-08-05, FULL PARITY pass item C.4)', () => {
  it('excludes Meals/Advance Repayment/Escrow & Deposits from cost, tracking them in excludedTotal', () => {
    const deductions = [
      { amount: 100, source: 'settlement', category: 'Insurance—Truck', tax_deductible: false },
      { amount: 50, source: 'manual', category: 'Meals (per diem covered)', tax_deductible: false },
      { amount: 200, source: 'manual', category: 'Advance Repayment', tax_deductible: false },
      { amount: 75, source: 'settlement', category: 'Escrow & Deposits', tax_deductible: false },
    ];
    const result = calcCanonicalCpm(5000, 1000, deductions, [], [], []);
    expect(result.costPerMile).toBeCloseTo(0.1, 5); // only the $100 insurance counts
    expect(result.excludedTotal).toBe(325); // 50 + 200 + 75
  });

  it('buckets fuel/maintenance/tolls/insurance/permits/driver-pay correctly', () => {
    const deductions = [
      { amount: 100, source: 'settlement', category: 'Insurance—Truck', tax_deductible: false },
      { amount: 60, source: 'manual', category: 'Permits, Licenses & Road Taxes', tax_deductible: true },
      { amount: 400, source: 'manual', category: 'Contract Labor (1099)', tax_deductible: true },
    ];
    const fuel = [{ amount: 500, discount: 20, settlement_id: null }];
    const maintenance = [{ cost: 300 }];
    const tolls = [{ amount: 40 }];
    const result = calcCanonicalCpm(5000, 1000, deductions, fuel, maintenance, tolls);
    const byCategory = Object.fromEntries(result.buckets.map((b) => [b.category, b.amount]));
    expect(byCategory['Insurance']).toBe(100);
    expect(byCategory['Permits & Road Taxes']).toBe(60);
    expect(byCategory['Driver Pay']).toBe(400);
    expect(byCategory['Fuel & DEF']).toBe(480); // 500 - 20 discount
    expect(byCategory['Maintenance & Repairs']).toBe(300);
    expect(byCategory['Tolls']).toBe(40);
    expect(result.costPerMile).toBeCloseTo((100 + 60 + 400 + 480 + 300 + 40) / 1000, 5);
  });

  it('excludes a SETTLEMENT-LINKED fuel purchase from the Fuel & DEF bucket (already represented by withheld deductions)', () => {
    const deductions = [{ amount: 90, source: 'settlement', category: 'Fuel & DEF', tax_deductible: false }];
    const linkedFuel = [{ amount: 90, discount: 0, settlement_id: 'sett-1' }];
    const result = calcCanonicalCpm(5000, 1000, deductions, linkedFuel, [], []);
    const byCategory = Object.fromEntries(result.buckets.map((b) => [b.category, b.amount]));
    expect(byCategory['Fuel & DEF']).toBe(90); // from the deduction, not doubled by the linked fuel row
  });

  it('adds an estimated loan payment ONLY when the carrier is not already withholding one', () => {
    const noWithheldLoan = calcCanonicalCpm(5000, 1000, [], [], [], [], 250);
    const withheldLoan = calcCanonicalCpm(
      5000,
      1000,
      [{ amount: 250, source: 'settlement', category: 'Truck/Trailer Payments', tax_deductible: false }],
      [],
      [],
      [],
      250 // an estimate the caller computed anyway — must not be double-counted
    );
    const noWithheldBucket = Object.fromEntries(noWithheldLoan.buckets.map((b) => [b.category, b.amount]));
    const withheldBucket = Object.fromEntries(withheldLoan.buckets.map((b) => [b.category, b.amount]));
    expect(noWithheldBucket['Loan/Lease Payment']).toBe(250);
    expect(withheldBucket['Loan/Lease Payment']).toBe(250); // from the withheld deduction only, not 500
  });

  it('returns nulls when there are no miles (avoids divide-by-zero)', () => {
    const result = calcCanonicalCpm(5000, 0, [], [], [], []);
    expect(result.revenuePerMile).toBeNull();
    expect(result.costPerMile).toBeNull();
    expect(result.profitPerMile).toBeNull();
    expect(result.fixedCostPerMile).toBeNull();
    expect(result.variableCostPerMile).toBeNull();
  });

  it('splits FIXED vs VARIABLE buckets (spec item C.3)', () => {
    const deductions = [
      { amount: 100, source: 'settlement', category: 'Insurance—Truck', tax_deductible: false }, // fixed
      { amount: 60, source: 'manual', category: 'Association Dues', tax_deductible: true }, // fixed
    ];
    const fuel = [{ amount: 480, discount: 0, settlement_id: null }]; // variable
    const tolls = [{ amount: 40 }]; // variable
    const result = calcCanonicalCpm(5000, 1000, deductions, fuel, [], tolls);
    expect(result.fixedTotal).toBe(160);
    expect(result.variableTotal).toBe(520);
    expect(result.fixedCostPerMile).toBeCloseTo(0.16, 5);
    expect(result.variableCostPerMile).toBeCloseTo(0.52, 5);
    expect(result.costPerMile).toBeCloseTo((result.fixedTotal + result.variableTotal) / 1000, 5);
  });

  it('a truck cost basis payment (5th param) is classified fixed', () => {
    const result = calcCanonicalCpm(5000, 1000, [], [], [], [], 300);
    expect(result.fixedTotal).toBe(300);
    expect(result.variableTotal).toBe(0);
  });

  it('excludes a Major Repairs & Overhauls one-off from cost/mile while listing it separately (spec item C.2)', () => {
    const deductions = [
      { amount: 400, source: 'manual', category: 'Fuel & DEF', tax_deductible: true },
      {
        amount: 6500,
        source: 'manual',
        category: 'Major Repairs & Overhauls',
        tax_deductible: true,
        description: 'Engine in-frame overhaul',
      },
    ];
    const result = calcCanonicalCpm(5000, 1000, deductions, [], [], []);
    expect(result.costPerMile).toBeCloseTo(0.4, 5); // only the $400 fuel line
    expect(result.excludedOneOffs).toHaveLength(1);
    expect(result.excludedOneOffs[0]).toMatchObject({
      description: 'Engine in-frame overhaul',
      amount: 6500,
      reason: 'major_repair_overhaul',
    });
    // Major-repair exclusion never touches the meals/advance/escrow excludedTotal.
    expect(result.excludedTotal).toBe(0);
  });

  it('excludes a vehicle-purchase-shaped deduction (e.g. a down payment logged as a deduction) from cost/mile', () => {
    const deductions = [
      { amount: 400, source: 'manual', category: 'Fuel & DEF', tax_deductible: true },
      { amount: 15000, source: 'manual', category: 'Other', tax_deductible: true, description: 'Truck down payment' },
    ];
    const result = calcCanonicalCpm(5000, 1000, deductions, [], [], []);
    expect(result.costPerMile).toBeCloseTo(0.4, 5);
    expect(result.excludedOneOffs).toHaveLength(1);
    expect(result.excludedOneOffs[0].reason).toBe('vehicle_purchase');
  });
});

describe('normalizeToWeeklyPayment', () => {
  it('a weekly payment passes through unchanged', () => {
    expect(normalizeToWeeklyPayment(300, 'weekly')).toBe(300);
  });

  it('a bi-weekly payment halves', () => {
    expect(normalizeToWeeklyPayment(600, 'bi-weekly')).toBe(300);
  });

  it('a monthly payment converts to its weekly-equivalent', () => {
    expect(normalizeToWeeklyPayment(1300, 'monthly')).toBeCloseTo((1300 * 12) / 52, 5);
  });

  it('defaults an unrecognized/missing frequency to monthly', () => {
    expect(normalizeToWeeklyPayment(1300, null)).toBeCloseTo((1300 * 12) / 52, 5);
    expect(normalizeToWeeklyPayment(1300, 'unknown')).toBeCloseTo((1300 * 12) / 52, 5);
  });
});

describe('ppmColor', () => {
  it('is green strictly above $0.50 (legacy: ppm>0.5)', () => {
    expect(ppmColor(0.51)).toBe('green');
  });

  it('is orange at exactly $0.50 and down to just above $0', () => {
    expect(ppmColor(0.5)).toBe('orange');
    expect(ppmColor(0.01)).toBe('orange');
  });

  it('is red at 0 or negative', () => {
    expect(ppmColor(0)).toBe('red');
    expect(ppmColor(-0.2)).toBe('red');
  });
});
