import { sumHouseholdIncome } from '@/src/tax/household';
import type { HouseholdIncome } from '@/src/types/db';

function income(overrides: Partial<HouseholdIncome>): HouseholdIncome {
  return {
    id: 'inc-1',
    user_id: 'user-1',
    member_id: 'member-1',
    tax_year: 2026,
    income_type: 'w2_wages',
    annual_amount: 0,
    federal_withheld: 0,
    document_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('sumHouseholdIncome', () => {
  it('sums annual_amount across every row for the resolved tax year', () => {
    const rows = [income({ id: 'a', annual_amount: 40000 }), income({ id: 'b', member_id: 'member-2', annual_amount: 5000 })];
    expect(sumHouseholdIncome(rows, 2026)).toBe(45000);
  });

  it('excludes rows from a different tax year, even a prior year for the same member', () => {
    const rows = [income({ id: 'a', tax_year: 2025, annual_amount: 40000 }), income({ id: 'b', tax_year: 2026, annual_amount: 42000 })];
    expect(sumHouseholdIncome(rows, 2026)).toBe(42000);
  });

  it('sums across multiple household members, not just a single "spouse" relation', () => {
    const rows = [
      income({ id: 'a', member_id: 'spouse-1', annual_amount: 30000 }),
      income({ id: 'b', member_id: 'child-1', annual_amount: 8000 }),
    ];
    expect(sumHouseholdIncome(rows, 2026)).toBe(38000);
  });

  it('returns 0 for an empty list', () => {
    expect(sumHouseholdIncome([], 2026)).toBe(0);
  });
});
