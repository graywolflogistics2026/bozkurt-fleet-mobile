import { buildAccountantPackage, estimateLoanInterest, matchReimbursementCategory } from '@/src/stats/accountantPackage';
import type { Deduction, MaintenanceRecord, FuelPurchase, LoanRow, CreditCardRow, UserCategory } from '@/src/types/db';
import type { ExtractedRevenueItem } from '@/src/import/types';

function deduction(overrides: Partial<Deduction>): Deduction {
  return {
    id: 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    document_id: null,
    ded_date: '2026-01-01',
    code: null,
    description: null,
    amount: 0,
    category: 'Misc',
    store: null,
    payment_method: null,
    source: 'manual',
    warranty_years: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function maintenance(overrides: Partial<MaintenanceRecord>): MaintenanceRecord {
  return {
    id: 'm1',
    user_id: 'u1',
    truck_id: null,
    document_id: null,
    service_date: '2026-01-01',
    service_type: 'oil',
    description: null,
    odometer: null,
    engine_hours: null,
    cost: 0,
    vendor: null,
    invoice_number: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function fuel(overrides: Partial<FuelPurchase>): FuelPurchase {
  return {
    id: 'f1',
    user_id: 'u1',
    truck_id: null,
    settlement_id: null,
    driver_id: null,
    fuel_type: 'tractor',
    purchase_date: '2026-01-01',
    location: null,
    state: null,
    gallons: null,
    amount: 0,
    discount: 0,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function loan(overrides: Partial<LoanRow>): LoanRow {
  return {
    id: 'l1',
    user_id: 'u1',
    name: 'Truck loan',
    lender: null,
    original_amount: null,
    balance: 0,
    payment: null,
    frequency: null,
    apr: 0,
    next_due: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function card(overrides: Partial<CreditCardRow>): CreditCardRow {
  return {
    id: 'c1',
    user_id: 'u1',
    name: 'Business Visa',
    last_four: null,
    credit_limit: 0,
    balance: 0,
    apr: null,
    due_day: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const noUserCategories: UserCategory[] = [];
const todayIso = '2026-06-01';

describe('estimateLoanInterest', () => {
  it('approximates annual interest as balance × APR', () => {
    expect(estimateLoanInterest(loan({ balance: 50000, apr: 6 }))).toBe(3000);
  });

  it('is 0 when balance or APR is missing/zero', () => {
    expect(estimateLoanInterest(loan({ balance: 0, apr: 6 }))).toBe(0);
    expect(estimateLoanInterest(loan({ balance: 50000, apr: 0 }))).toBe(0);
    expect(estimateLoanInterest(loan({ balance: 50000, apr: null }))).toBe(0);
  });
});

describe('matchReimbursementCategory', () => {
  it('matches toll/scale reimbursements to Tolls & Scales', () => {
    expect(matchReimbursementCategory('Toll Reimbursement')).toBe('Tolls & Scales');
    expect(matchReimbursementCategory('CAT Scale reimbursement')).toBe('Tolls & Scales');
  });

  it('matches permit reimbursements to Permits, Licenses & Road Taxes', () => {
    expect(matchReimbursementCategory('Permit fee reimbursement')).toBe('Permits, Licenses & Road Taxes');
  });

  it('falls back to Misc for an unrecognized description', () => {
    expect(matchReimbursementCategory('Something unusual')).toBe('Misc');
    expect(matchReimbursementCategory(undefined)).toBe('Misc');
  });
});

describe('buildAccountantPackage', () => {
  it('sums out-of-pocket deductions by canonical category, excluding settlement-withheld rows (invariant #1)', () => {
    const result = buildAccountantPackage(
      [
        deduction({ category: 'Fuel & DEF', amount: 100, source: 'manual' }),
        deduction({ category: 'Fuel & DEF', amount: 50, source: 'import' }),
        deduction({ category: 'Insurance—Truck', amount: 9999, source: 'settlement' }),
      ],
      [],
      [],
      [],
      [],
      [],
      noUserCategories,
      0,
      0,
      todayIso
    );
    expect(result.scheduleC).toEqual([{ category: 'Fuel & DEF', amount: 150 }]);
    expect(result.totalExpenses).toBe(150);
  });

  it('folds maintenance_records into Maintenance & Repairs alongside deductions', () => {
    const result = buildAccountantPackage(
      [deduction({ category: 'Maintenance & Repairs', amount: 200 })],
      [maintenance({ cost: 300 }), maintenance({ cost: 150 })],
      [],
      [],
      [],
      [],
      noUserCategories,
      0,
      0,
      todayIso
    );
    const bucket = result.scheduleC.find((c) => c.category === 'Maintenance & Repairs');
    expect(bucket?.amount).toBe(650);
  });

  it('folds fuel_purchases (net of discount) into Fuel & DEF', () => {
    const result = buildAccountantPackage([], [], [fuel({ amount: 500, discount: 40 })], [], [], [], noUserCategories, 0, 0, todayIso);
    expect(result.scheduleC).toEqual([{ category: 'Fuel & DEF', amount: 460 }]);
  });

  it('folds estimated loan interest into Truck/Trailer Payments, not the full payment', () => {
    const result = buildAccountantPackage([], [], [], [loan({ balance: 40000, apr: 5 })], [], [], noUserCategories, 0, 0, todayIso);
    expect(result.scheduleC).toEqual([{ category: 'Truck/Trailer Payments', amount: 2000 }]);
  });

  it('a reimbursement offsets its matched expense category instead of counting as income', () => {
    const revenueItems: ExtractedRevenueItem[] = [{ desc: 'Toll Reimbursement', amount: 80, incomeType: 'reimbursement' }];
    const result = buildAccountantPackage(
      [deduction({ category: 'Tolls & Scales', amount: 200 })],
      [],
      [],
      [],
      [],
      revenueItems,
      noUserCategories,
      0,
      0,
      todayIso
    );
    expect(result.scheduleC).toEqual([{ category: 'Tolls & Scales', amount: 120 }]);
    expect(result.income.total).toBe(0);
  });

  it('clamps a reimbursement offset at 0 rather than going negative when it exceeds the matched category', () => {
    const revenueItems: ExtractedRevenueItem[] = [{ desc: 'Toll Reimbursement', amount: 500, incomeType: 'reimbursement' }];
    const result = buildAccountantPackage(
      [deduction({ category: 'Tolls & Scales', amount: 100 })],
      [],
      [],
      [],
      [],
      revenueItems,
      noUserCategories,
      0,
      0,
      todayIso
    );
    // Nets to 0, which is filtered out of the rollup entirely.
    expect(result.scheduleC.find((c) => c.category === 'Tolls & Scales')).toBeUndefined();
  });

  it('an IFTA refund is real income, never netted against an expense (docs/INDUSTRY_TAXONOMY.md §D)', () => {
    const revenueItems: ExtractedRevenueItem[] = [
      { desc: 'IFTA quarterly refund', amount: 60, incomeType: 'ifta_refund' },
    ];
    const result = buildAccountantPackage(
      [deduction({ category: 'Fuel & DEF', amount: 1000 })],
      [],
      [],
      [],
      [],
      revenueItems,
      noUserCategories,
      0,
      0,
      todayIso
    );
    expect(result.scheduleC).toEqual([{ category: 'Fuel & DEF', amount: 1000 }]);
    expect(result.income.total).toBe(60);
    expect(result.income.byType).toEqual([{ category: 'ifta_refund', amount: 60 }]);
  });

  it('resolves a custom category through its schedule_c_bucket, same as Operating P&L', () => {
    const userCategories: UserCategory[] = [
      {
        id: 'uc1',
        user_id: 'u1',
        name: 'My Custom Thing',
        kind: 'expense',
        schedule_c_bucket: 'Office & Admin',
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    const result = buildAccountantPackage(
      [deduction({ category: 'My Custom Thing', amount: 75 })],
      [],
      [],
      [],
      [],
      [],
      userCategories,
      0,
      0,
      todayIso
    );
    expect(result.scheduleC).toEqual([{ category: 'Office & Admin', amount: 75 }]);
  });

  it('passes per diem days/deduction through unchanged (computed by the shared tax module, not re-derived here)', () => {
    const result = buildAccountantPackage([], [], [], [], [], [], noUserCategories, 70, 4480, todayIso);
    expect(result.perDiem).toEqual({ days: 70, deduction: 4480 });
  });

  it('assetsByCategory sources from the same EQUIP-coded deductions as the real Asset Register (§4 bug #3 fix)', () => {
    const result = buildAccountantPackage(
      [deduction({ category: 'Tools & Equipment', amount: 120 }), deduction({ category: 'Electronics', amount: 80 })],
      [],
      [],
      [],
      [],
      [],
      noUserCategories,
      0,
      0,
      todayIso
    );
    const tools = result.assetsByCategory.find((c) => c.category === 'Tools & Equipment');
    const electronics = result.assetsByCategory.find((c) => c.category === 'Electronics');
    const total = result.assetsByCategory.find((c) => c.category === 'Total');
    expect(tools).toMatchObject({ count: 1, total: 120 });
    expect(electronics).toMatchObject({ count: 1, total: 80 });
    expect(total).toMatchObject({ count: 2, total: 200 });
  });

  it('loansAndCards summarizes raw loan and credit card balances', () => {
    const result = buildAccountantPackage(
      [],
      [],
      [],
      [loan({ name: 'Truck Loan', balance: 40000, payment: 900 }), loan({ name: 'Trailer Loan', balance: 10000, payment: 300 })],
      [card({ name: 'Business Visa', balance: 500, credit_limit: 5000 })],
      [],
      noUserCategories,
      0,
      0,
      todayIso
    );
    expect(result.loansAndCards.totalLoanBalance).toBe(50000);
    expect(result.loansAndCards.loans).toEqual([
      { name: 'Truck Loan', balance: 40000, payment: 900 },
      { name: 'Trailer Loan', balance: 10000, payment: 300 },
    ]);
    expect(result.loansAndCards.totalCardBalance).toBe(500);
    expect(result.loansAndCards.cards).toEqual([{ name: 'Business Visa', balance: 500, limit: 5000 }]);
  });
});
