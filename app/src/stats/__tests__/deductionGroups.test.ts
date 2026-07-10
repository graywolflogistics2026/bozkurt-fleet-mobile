import { groupDeductions, isSettlementDed } from '@/src/stats/deductionGroups';
import type { Deduction } from '@/src/types/db';

function ded(overrides: Partial<Deduction>): Deduction {
  return {
    id: overrides.id ?? 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    document_id: null,
    ded_date: '2026-06-01',
    code: null,
    description: 'Deduction',
    amount: 0,
    category: null,
    store: null,
    payment_method: null,
    source: 'manual',
    warranty_years: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('isSettlementDed', () => {
  it('is true only for source === settlement (CLAUDE.md invariant #1)', () => {
    expect(isSettlementDed(ded({ source: 'settlement' }))).toBe(true);
    expect(isSettlementDed(ded({ source: 'import' }))).toBe(false);
    expect(isSettlementDed(ded({ source: 'manual' }))).toBe(false);
  });
});

describe('groupDeductions', () => {
  it('splits out-of-pocket vs withheld and totals each independently', () => {
    const rows = [
      ded({ id: '1', source: 'import', amount: 100 }),
      ded({ id: '2', source: 'settlement', amount: 40 }),
      ded({ id: '3', source: 'manual', amount: 25 }),
      ded({ id: '4', source: 'settlement', amount: 60 }),
    ];

    const result = groupDeductions(rows);

    expect(result.outOfPocket.map((x) => x.id)).toEqual(['1', '3']);
    expect(result.withheld.map((x) => x.id)).toEqual(['2', '4']);
    expect(result.outOfPocketTotal).toBe(125);
    expect(result.withheldTotal).toBe(100);
  });

  it('never lets a withheld row leak into the deductible total', () => {
    const rows = [ded({ id: '1', source: 'settlement', amount: 500 })];
    const result = groupDeductions(rows);
    expect(result.outOfPocketTotal).toBe(0);
    expect(result.withheldTotal).toBe(500);
  });

  it('handles an empty list', () => {
    const result = groupDeductions([]);
    expect(result).toEqual({ outOfPocket: [], withheld: [], outOfPocketTotal: 0, withheldTotal: 0 });
  });
});
