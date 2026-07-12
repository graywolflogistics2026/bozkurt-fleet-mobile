import { buildProfitLoss, resolveScheduleCBucket } from '@/src/stats/profitLoss';
import type { UserCategory } from '@/src/types/db';

function userCat(overrides: Partial<UserCategory>): UserCategory {
  return {
    id: 'c1',
    user_id: 'u1',
    name: 'My Custom Cat',
    kind: 'expense',
    schedule_c_bucket: 'Office & Admin',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveScheduleCBucket', () => {
  it('returns a canonical category as its own bucket', () => {
    expect(resolveScheduleCBucket('Fuel & DEF', [])).toBe('Fuel & DEF');
  });

  it('resolves a custom category through user_categories.schedule_c_bucket', () => {
    const cats = [userCat({ name: 'Truck Wash', schedule_c_bucket: 'Truck Supplies & Equipment' })];
    expect(resolveScheduleCBucket('Truck Wash', cats)).toBe('Truck Supplies & Equipment');
  });

  it('defaults to Misc for a null category or an unknown/deleted custom category', () => {
    expect(resolveScheduleCBucket(null, [])).toBe('Misc');
    expect(resolveScheduleCBucket('Ghost Category', [])).toBe('Misc');
  });

  it('never resolves an income-kind category as an expense bucket', () => {
    const cats = [userCat({ name: 'Side Gig', kind: 'income', schedule_c_bucket: null })];
    expect(resolveScheduleCBucket('Side Gig', cats)).toBe('Misc');
  });
});

describe('buildProfitLoss', () => {
  it('nets ALL deductions (including settlement-withheld) against gross revenue, legacy rOper() parity', () => {
    const settlements = [{ gross: 3000 }, { gross: 2500 }];
    const deductions = [
      { amount: 500, category: 'Fuel & DEF' },
      { amount: 200, category: 'Insurance—Truck' },
    ];
    const result = buildProfitLoss(settlements, deductions, []);
    expect(result.revenue).toBe(5500);
    expect(result.totalExpenses).toBe(700);
    expect(result.netIncome).toBe(4800);
  });

  it('groups expenses by resolved Schedule C bucket, sorted descending', () => {
    const deductions = [
      { amount: 100, category: 'Fuel & DEF' },
      { amount: 50, category: 'Fuel & DEF' },
      { amount: 300, category: 'My Custom Cat' },
    ];
    const cats = [userCat({ name: 'My Custom Cat', schedule_c_bucket: 'Office & Admin' })];
    const result = buildProfitLoss([], deductions, cats);
    expect(result.expensesByBucket).toEqual([
      { category: 'Office & Admin', amount: 300 },
      { category: 'Fuel & DEF', amount: 150 },
    ]);
  });

  it('handles zero settlements/deductions without dividing by zero or throwing', () => {
    const result = buildProfitLoss([], [], []);
    expect(result).toEqual({ revenue: 0, totalExpenses: 0, netIncome: 0, expensesByBucket: [] });
  });
});
