import {
  buildAccountantPackage,
  estimateLoanInterest,
  matchReimbursementCategory,
  matchesAccountantScope,
  buildLineItems,
  buildScheduleCTotals,
  buildLumperFees,
  buildPerDiemBlock,
  buildCapitalAssets,
  buildOwnersEquity,
  checkMiscConcentration,
} from '@/src/stats/accountantPackage';
import type { Deduction, Equipment, MaintenanceRecord, FuelPurchase, LoanRow, CreditCardRow, Toll, Truck, UserCategory } from '@/src/types/db';
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
    tax_deductible: true,
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
    source: 'import',
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

function toll(overrides: Partial<Toll>): Toll {
  return {
    id: 't1',
    user_id: 'u1',
    network: 'ezpass',
    toll_date: '2026-01-01',
    amount: 0,
    plaza: null,
    tags: null,
    source: 'import',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function truckRow(overrides: Partial<Truck>): Truck {
  return {
    id: 'tr1',
    user_id: 'u1',
    unit_number: 'Unit 100',
    vin: null,
    year: null,
    make: null,
    model: null,
    engine: null,
    current_odometer: null,
    fleet_mpg: null,
    apu_hours: null,
    is_active: true,
    trailer_unit_number: null,
    trailer_vin: null,
    trailer_year: null,
    trailer_make: null,
    trailer_model: null,
    purchase_price: null,
    purchase_date: null,
    financing: null,
    loan_id: null,
    trailer_purchase_price: null,
    trailer_purchase_date: null,
    trailer_financing: null,
    trailer_loan_id: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Truck;
}

function equipmentRow(overrides: Partial<Equipment>): Equipment {
  return {
    id: 'e1',
    user_id: 'u1',
    name: 'Reefer Unit',
    category: null,
    purchase_price: null,
    purchase_date: null,
    financing: null,
    loan_id: null,
    notes: null,
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

  it('excludes a tax_deductible:false row from Schedule C even when source is not settlement (meals & advance repayments, owner decision 2026-07-17)', () => {
    const result = buildAccountantPackage(
      [
        deduction({ category: 'Fuel & DEF', amount: 100, source: 'manual' }),
        deduction({ category: 'Meals (per diem covered)', amount: 25, source: 'import', tax_deductible: false }),
        deduction({ category: 'Advance Repayment', amount: 60, source: 'import', tax_deductible: false }),
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
    expect(result.scheduleC).toEqual([{ category: 'Fuel & DEF', amount: 100 }]);
    expect(result.totalExpenses).toBe(100);
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

describe('matchesAccountantScope (ORIGIN RULE, owner decision 2026-08-05, FULL PARITY pass item B.1)', () => {
  it('combined always matches regardless of origin', () => {
    expect(matchesAccountantScope('settlement', 'combined')).toBe(true);
    expect(matchesAccountantScope('import', 'combined')).toBe(true);
    expect(matchesAccountantScope(null, 'combined')).toBe(true);
  });

  it('outOfPocket matches import/manual, never settlement', () => {
    expect(matchesAccountantScope('import', 'outOfPocket')).toBe(true);
    expect(matchesAccountantScope('manual', 'outOfPocket')).toBe(true);
    expect(matchesAccountantScope('settlement', 'outOfPocket')).toBe(false);
  });

  it('withheld matches ONLY settlement', () => {
    expect(matchesAccountantScope('settlement', 'withheld')).toBe(true);
    expect(matchesAccountantScope('import', 'withheld')).toBe(false);
    expect(matchesAccountantScope('manual', 'withheld')).toBe(false);
  });
});

describe('buildLineItems (owner decision 2026-08-05, FULL PARITY pass item B.1/C.1)', () => {
  it('skips zero-amount rows entirely (spec item C.1)', () => {
    const items = buildLineItems(
      [deduction({ amount: 0, ded_date: '2026-06-01' })],
      [fuel({ amount: 0, purchase_date: '2026-06-01' })],
      [maintenance({ cost: 0, service_date: '2026-06-01' })],
      [toll({ amount: 0, toll_date: '2026-06-01' })],
      2026,
      6,
      'combined'
    );
    expect(items).toHaveLength(0);
  });

  it('ORIGIN RULE: a settlement-linked fuel/maintenance/toll row never appears in the out-of-pocket scope', () => {
    const items = buildLineItems(
      [],
      [fuel({ id: 'fuel-settlement', amount: 100, purchase_date: '2026-06-05', settlement_id: 'sett-1' })],
      [maintenance({ id: 'maint-settlement', cost: 200, service_date: '2026-06-05', source: 'settlement' })],
      [toll({ id: 'toll-settlement', amount: 20, toll_date: '2026-06-05', source: 'settlement' })],
      2026,
      6,
      'outOfPocket'
    );
    expect(items).toHaveLength(0);
  });

  it('a standalone (non-settlement) fuel/maintenance/toll row DOES appear in the out-of-pocket scope', () => {
    const items = buildLineItems(
      [],
      [fuel({ id: 'fuel-standalone', amount: 100, purchase_date: '2026-06-05', settlement_id: null })],
      [maintenance({ id: 'maint-standalone', cost: 200, service_date: '2026-06-05', source: 'import' })],
      [toll({ id: 'toll-standalone', amount: 20, toll_date: '2026-06-05', source: 'manual' })],
      2026,
      6,
      'outOfPocket'
    );
    expect(items.map((i) => i.id).sort()).toEqual(['fuel-standalone', 'maint-standalone', 'toll-standalone']);
  });

  it('withheld scope shows only settlement-origin rows', () => {
    const items = buildLineItems(
      [
        deduction({ id: 'ded-out', amount: 50, ded_date: '2026-06-05', source: 'manual' }),
        deduction({ id: 'ded-withheld', amount: 60, ded_date: '2026-06-05', source: 'settlement' }),
      ],
      [],
      [],
      [],
      2026,
      6,
      'withheld'
    );
    expect(items.map((i) => i.id)).toEqual(['ded-withheld']);
  });

  it('filters by year and month', () => {
    const items = buildLineItems(
      [
        deduction({ id: 'in-month', amount: 50, ded_date: '2026-06-15' }),
        deduction({ id: 'wrong-month', amount: 50, ded_date: '2026-05-15' }),
        deduction({ id: 'wrong-year', amount: 50, ded_date: '2025-06-15' }),
      ],
      [],
      [],
      [],
      2026,
      6,
      'combined'
    );
    expect(items.map((i) => i.id)).toEqual(['in-month']);
  });

  it('month=null rolls up the whole year', () => {
    const items = buildLineItems(
      [deduction({ id: 'jan', amount: 50, ded_date: '2026-01-15' }), deduction({ id: 'dec', amount: 50, ded_date: '2026-12-15' })],
      [],
      [],
      [],
      2026,
      null,
      'combined'
    );
    expect(items.map((i) => i.id).sort()).toEqual(['dec', 'jan']);
  });

  it('marks a personally-paid deduction as owner-paid', () => {
    const items = buildLineItems(
      [deduction({ amount: 50, ded_date: '2026-06-05', payment_method: 'Personal Credit Card' })],
      [],
      [],
      [],
      2026,
      6,
      'combined'
    );
    expect(items[0].isOwnerPaid).toBe(true);
  });
});

describe('buildScheduleCTotals (owner decision 2026-08-05, FULL PARITY pass item A.5/B.2)', () => {
  it('sums line items by category and attaches a Schedule C line', () => {
    const items = buildLineItems(
      [deduction({ amount: 100, category: 'Insurance—Truck', ded_date: '2026-06-05', tax_deductible: true, source: 'manual' })],
      [fuel({ amount: 200, purchase_date: '2026-06-05', settlement_id: null })],
      [],
      [],
      2026,
      6,
      'combined'
    );
    const totals = buildScheduleCTotals(items, noUserCategories);
    const byCategory = Object.fromEntries(totals.map((t) => [t.category, t]));
    expect(byCategory['Insurance—Truck'].amount).toBe(100);
    expect(byCategory['Insurance—Truck'].scheduleCLine).toBe('15');
    expect(byCategory['Fuel & DEF'].amount).toBe(200);
    expect(byCategory['Fuel & DEF'].scheduleCLine).toBe('22');
  });
});

describe('checkMiscConcentration (owner decision 2026-08-05, FULL PARITY follow-up item H.1)', () => {
  it('flags Misc when it exceeds 20% of the grand total', () => {
    const totals = [
      { category: 'Misc', amount: 300, scheduleCLine: null },
      { category: 'Fuel & DEF', amount: 700, scheduleCLine: '22' },
    ];
    const warning = checkMiscConcentration(totals);
    expect(warning).not.toBeNull();
    expect(warning?.miscAmount).toBe(300);
    expect(warning?.miscPct).toBeCloseTo(0.3, 5);
  });

  it('does not flag Misc at or under the 20% threshold', () => {
    const totals = [
      { category: 'Misc', amount: 200, scheduleCLine: null },
      { category: 'Fuel & DEF', amount: 800, scheduleCLine: '22' },
    ];
    expect(checkMiscConcentration(totals)).toBeNull();
  });

  it('returns null when there is no Misc bucket at all', () => {
    const totals = [{ category: 'Fuel & DEF', amount: 800, scheduleCLine: '22' }];
    expect(checkMiscConcentration(totals)).toBeNull();
  });

  it('returns null when the grand total is 0 (avoids a divide-by-zero false positive)', () => {
    expect(checkMiscConcentration([])).toBeNull();
  });
});

describe('buildLumperFees (owner decision 2026-08-05, FULL PARITY pass item B.2)', () => {
  it('returns only Lumper Fees line items', () => {
    const items = buildLineItems(
      [
        deduction({ id: 'lumper', amount: 75, category: 'Lumper Fees', ded_date: '2026-06-05', tax_deductible: true, source: 'manual' }),
        deduction({ id: 'other', amount: 50, category: 'Misc', ded_date: '2026-06-05', tax_deductible: true, source: 'manual' }),
      ],
      [],
      [],
      [],
      2026,
      6,
      'combined'
    );
    expect(buildLumperFees(items).map((i) => i.id)).toEqual(['lumper']);
  });
});

describe('buildPerDiemBlock (owner decision 2026-08-05, FULL PARITY pass item B.2)', () => {
  const perDiem = { daily_rate: 80, deductible_pct: 80, full_daily_rate: 80 };

  it('computes month days/deduction separately from YTD', () => {
    const settlements = [
      { week_ending: '2026-06-06', per_diem_days: 7 },
      { week_ending: '2026-06-13', per_diem_days: 7 },
      { week_ending: '2026-01-10', per_diem_days: 7 },
    ];
    const result = buildPerDiemBlock(settlements, 2026, 6, perDiem);
    expect(result.monthDays).toBe(14);
    expect(result.monthDeduction).toBeCloseTo(14 * 80 * 0.8, 5);
    expect(result.ytdDays).toBe(21); // includes the January week too
    expect(result.ytdDeduction).toBeCloseTo(21 * 80 * 0.8, 5);
  });

  it('a settlement from a different year never counts toward YTD', () => {
    const settlements = [{ week_ending: '2025-12-31', per_diem_days: 7 }];
    const result = buildPerDiemBlock(settlements, 2026, null, perDiem);
    expect(result.ytdDays).toBe(0);
  });
});

describe('buildCapitalAssets (owner decision 2026-08-05, FULL PARITY pass item B.6)', () => {
  it('includes a truck, its trailer, and equipment as separate rows, each with financing', () => {
    const trucks = [
      truckRow({
        unit_number: 'Unit 100',
        purchase_price: 150000,
        purchase_date: '2025-01-01',
        financing: 'loan',
        trailer_unit_number: 'Trailer 200',
        trailer_purchase_price: 40000,
        trailer_purchase_date: '2025-02-01',
        trailer_financing: 'cash',
      }),
    ];
    const equipment = [equipmentRow({ name: 'Reefer Unit', purchase_price: 20000, purchase_date: '2025-03-01', financing: 'loan' })];
    const rows = buildCapitalAssets(trucks, equipment);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.type === 'truck')).toMatchObject({ name: 'Unit 100', price: 150000, financing: 'loan' });
    expect(rows.find((r) => r.type === 'trailer')).toMatchObject({ name: 'Trailer 200', price: 40000, financing: 'cash' });
    expect(rows.find((r) => r.type === 'equipment')).toMatchObject({ name: 'Reefer Unit', price: 20000, financing: 'loan' });
  });

  it('never includes a truck/equipment with no purchase price recorded', () => {
    const rows = buildCapitalAssets([truckRow({ purchase_price: null })], [equipmentRow({ purchase_price: null })]);
    expect(rows).toHaveLength(0);
  });
});

describe('buildOwnersEquity (owner decision 2026-08-05, FULL PARITY pass item B.7)', () => {
  it('sums cash + linked contributions once each, never a hidden base constant', () => {
    const contributions = [
      { id: 'c1', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01' },
      { id: 'c2', tx_type: 'contribution' as const, amount: 448, tx_date: '2026-06-05', linked_deduction_id: 'ded-1' },
    ];
    const result = buildOwnersEquity(contributions, []);
    expect(result.cashAmount).toBe(60000);
    expect(result.linkedAmount).toBe(448);
    expect(result.total).toBe(60448); // counted once each, summed
  });

  it('never counts a draw as equity', () => {
    const contributions = [
      { id: 'c1', tx_type: 'contribution' as const, amount: 1000, tx_date: '2026-01-01' },
      { id: 'd1', tx_type: 'draw' as const, amount: 500, tx_date: '2026-01-02' },
    ];
    const result = buildOwnersEquity(contributions, []);
    expect(result.total).toBe(1000);
  });

  it('flags a warning (never mis-totals) when owner-paid line items outnumber linked contributions', () => {
    const contributions = [{ id: 'c1', tx_type: 'contribution' as const, amount: 100, tx_date: '2026-06-01', linked_deduction_id: 'ded-1' }];
    const lineItems = buildLineItems(
      [
        deduction({ id: 'owner-1', amount: 100, ded_date: '2026-06-05', payment_method: 'Personal Credit Card' }),
        deduction({ id: 'owner-2', amount: 200, ded_date: '2026-06-06', payment_method: 'Cash' }),
      ],
      [],
      [],
      [],
      2026,
      6,
      'combined'
    );
    const result = buildOwnersEquity(contributions, lineItems);
    expect(result.unmatchedOwnerPaidCount).toBe(1); // 2 owner-paid line items, only 1 linked contribution
  });

  it('unmatchedOwnerPaidCount is 0 when every owner-paid line item has a matching linked contribution', () => {
    const contributions = [
      { id: 'c1', tx_type: 'contribution' as const, amount: 100, tx_date: '2026-06-01', linked_deduction_id: 'ded-1' },
      { id: 'c2', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-06-02', linked_deduction_id: 'ded-2' },
    ];
    const lineItems = buildLineItems(
      [deduction({ amount: 100, ded_date: '2026-06-05', payment_method: 'Personal Credit Card' })],
      [],
      [],
      [],
      2026,
      6,
      'combined'
    );
    const result = buildOwnersEquity(contributions, lineItems);
    expect(result.unmatchedOwnerPaidCount).toBe(0);
  });
});
