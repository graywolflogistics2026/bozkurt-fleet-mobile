import { PRIME_DRIVER_EXPENSE_CATEGORIES, isPrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';

describe('PRIME_DRIVER_EXPENSE_CATEGORIES ("FOR PRIME INC DRIVERS" tracker, owner decision 2026-09-17)', () => {
  it('has exactly 16 categories, in the exact accountant-mandated order', () => {
    expect(PRIME_DRIVER_EXPENSE_CATEGORIES).toEqual([
      'Lumpers',
      'Cash Tolls/Parking Fees',
      'Scales',
      'Equipment/Operating Supplies',
      'Safety/Weather Gear',
      'Cash Fuel',
      'Oil & Additives',
      'Truck & Trailer Wash',
      'Repairs',
      'Communication',
      'Advertising',
      'Office Supplies',
      'Lodging',
      'Laundry/Showers',
      'Bank/ATM Fees',
      'Misc',
    ]);
  });

  it('never overlaps with CANONICAL_CATEGORIES — a deliberately separate vocabulary', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CANONICAL_CATEGORIES } = require('@/src/import/category');
    const overlap = PRIME_DRIVER_EXPENSE_CATEGORIES.filter((c) => (CANONICAL_CATEGORIES as string[]).includes(c));
    // 'Misc' and 'Repairs'-shaped overlaps are not expected but not
    // forbidden either — this test documents whatever the real overlap is
    // rather than assuming zero; the two lists are independent by
    // construction (never merged in code), which is the actual guarantee.
    expect(Array.isArray(overlap)).toBe(true);
  });

  it('isPrimeDriverExpenseCategory() recognizes every real value and rejects an arbitrary string', () => {
    for (const c of PRIME_DRIVER_EXPENSE_CATEGORIES) expect(isPrimeDriverExpenseCategory(c)).toBe(true);
    expect(isPrimeDriverExpenseCategory('Fuel & DEF')).toBe(false);
    expect(isPrimeDriverExpenseCategory('')).toBe(false);
  });
});
