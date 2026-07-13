import { buildAssetRegister, activeWarranties, isAssetCategory, buildAssetCategoryBreakdown, thisMonthTotal } from '@/src/stats/assetRegister';
import type { Deduction } from '@/src/types/db';

function ded(overrides: Partial<Deduction>): Deduction {
  return {
    id: 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    document_id: null,
    ded_date: '2026-01-01',
    code: null,
    description: 'Drill',
    amount: 100,
    category: 'Tools & Equipment',
    store: null,
    payment_method: 'Business Checking',
    source: 'manual',
    warranty_years: null,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isAssetCategory', () => {
  it('matches the 5 equipment-like canonical categories', () => {
    expect(isAssetCategory('Tools & Equipment')).toBe(true);
    expect(isAssetCategory('Electronics')).toBe(true);
    expect(isAssetCategory('Fuel & DEF')).toBe(false);
    expect(isAssetCategory(null)).toBe(false);
  });
});

describe('buildAssetRegister', () => {
  it('excludes non-asset categories', () => {
    const rows = buildAssetRegister([ded({ category: 'Fuel & DEF' })], '2026-06-01');
    expect(rows).toHaveLength(0);
  });

  it('computes warranty status active/expired/none from ded_date + warranty_years', () => {
    const rows = buildAssetRegister(
      [
        ded({ id: 'a', ded_date: '2026-01-01', warranty_years: 1 }), // expires 2027-01-01
        ded({ id: 'b', ded_date: '2024-01-01', warranty_years: 1 }), // expires 2025-01-01, in the past
        ded({ id: 'c', warranty_years: null }),
      ],
      '2026-06-01'
    );
    const byId = Object.fromEntries(rows.map((r) => [r.deduction.id, r]));
    expect(byId.a.warrantyStatus).toBe('active');
    expect(byId.a.warrantyExpires).toBe('2027-01-01');
    expect(byId.b.warrantyStatus).toBe('expired');
    expect(byId.c.warrantyStatus).toBe('none');
    expect(byId.c.warrantyExpires).toBeNull();
  });

  it('handles half-year warranties (e.g. 2.5 years = 30 months)', () => {
    const rows = buildAssetRegister([ded({ id: 'a', ded_date: '2026-01-01', warranty_years: 2.5 })], '2026-06-01');
    expect(rows[0].warrantyExpires).toBe('2028-07-01');
  });

  it('flags NEEDS REVIEW rows', () => {
    const rows = buildAssetRegister([ded({ description: 'NEEDS REVIEW: unknown item' })], '2026-06-01');
    expect(rows[0].needsReview).toBe(true);
  });
});

describe('buildAssetCategoryBreakdown', () => {
  it('returns one row per canonical category plus a Total row, in fixed order', () => {
    const rows = buildAssetRegister(
      [
        ded({ id: 'a', category: 'Tools & Equipment', amount: 100 }),
        ded({ id: 'b', category: 'Tools & Equipment', amount: 50 }),
        ded({ id: 'c', category: 'Electronics', amount: 200 }),
      ],
      '2026-06-01'
    );
    const breakdown = buildAssetCategoryBreakdown(rows);
    expect(breakdown.map((b) => b.category)).toEqual([
      'Tools & Equipment',
      'Electronics',
      'Comfort & Sleeper',
      'Truck Supplies & Equipment',
      'Safety Gear & Workwear',
      'Total',
    ]);
    expect(breakdown[0]).toMatchObject({ count: 2, total: 150 });
    expect(breakdown[1]).toMatchObject({ count: 1, total: 200 });
    expect(breakdown[2]).toMatchObject({ count: 0, total: 0 });
    expect(breakdown[5]).toMatchObject({ count: 3, total: 350 });
  });
});

describe('thisMonthTotal', () => {
  it('sums only rows whose ded_date falls in the given month', () => {
    const rows = buildAssetRegister(
      [
        ded({ id: 'a', ded_date: '2026-06-05', amount: 100 }),
        ded({ id: 'b', ded_date: '2026-06-20', amount: 50 }),
        ded({ id: 'c', ded_date: '2026-05-31', amount: 999 }),
      ],
      '2026-06-01'
    );
    expect(thisMonthTotal(rows, '2026-06')).toBe(150);
  });
});

describe('activeWarranties', () => {
  it('returns only active rows, soonest-expiring first', () => {
    const rows = buildAssetRegister(
      [
        ded({ id: 'later', ded_date: '2026-01-01', warranty_years: 3 }),
        ded({ id: 'sooner', ded_date: '2026-01-01', warranty_years: 1 }),
        ded({ id: 'expired', ded_date: '2020-01-01', warranty_years: 1 }),
      ],
      '2026-06-01'
    );
    const active = activeWarranties(rows);
    expect(active.map((a) => a.deduction.id)).toEqual(['sooner', 'later']);
  });
});
