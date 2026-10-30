// Batch A item 1 (2026-10-30): accountant -> canonical category sync.
import {
  ACCOUNTANT_TO_CANONICAL_CATEGORY,
  CANONICAL_TO_ACCOUNTANT_CATEGORY,
  canonicalSyncTarget,
  findCategoriesOutOfSync,
} from '@/src/primeDriverExpenses/categoryMapping';
import { PRIME_DRIVER_EXPENSE_CATEGORIES } from '@/src/primeDriverExpenses/categories';
import { CANONICAL_CATEGORIES } from '@/src/import/category';
import { computeKpis } from '@/src/stats/kpi';
import { reducesTrueProfit } from '@/src/stats/trueProfit';
import type { Deduction } from '@/src/types/db';

describe('accountant -> canonical map (owner table)', () => {
  it('has an entry for every accountant category, each a real canonical category or null', () => {
    for (const a of PRIME_DRIVER_EXPENSE_CATEGORIES) {
      expect(a in ACCOUNTANT_TO_CANONICAL_CATEGORY).toBe(true);
      const c = ACCOUNTANT_TO_CANONICAL_CATEGORY[a];
      if (c !== null) expect(CANONICAL_CATEGORIES).toContain(c);
    }
    expect(ACCOUNTANT_TO_CANONICAL_CATEGORY['Laundry/Showers']).toBeNull();
    expect(ACCOUNTANT_TO_CANONICAL_CATEGORY.Lumpers).toBe('Lumper Fees');
    expect(ACCOUNTANT_TO_CANONICAL_CATEGORY.Communication).toBe('Utilities & Subscriptions');
  });

  it('round-trips: the offered canonical category maps back to an accountant category', () => {
    for (const a of PRIME_DRIVER_EXPENSE_CATEGORIES) {
      const c = ACCOUNTANT_TO_CANONICAL_CATEGORY[a];
      if (!c || c === 'Misc') continue;
      expect(CANONICAL_TO_ACCOUNTANT_CATEGORY[c as keyof typeof CANONICAL_TO_ACCOUNTANT_CATEGORY]).not.toBeUndefined();
    }
  });
});

describe('canonicalSyncTarget', () => {
  it('offers only when the Deductions category is Misc, Other or empty', () => {
    expect(canonicalSyncTarget({ category: 'Misc', accountant_category: 'Lumpers' })).toBe('Lumper Fees');
    expect(canonicalSyncTarget({ category: 'Other', accountant_category: 'Scales' })).toBe('Tolls & Scales');
    expect(canonicalSyncTarget({ category: null, accountant_category: 'Repairs' })).toBe('Maintenance & Repairs');
    expect(canonicalSyncTarget({ category: '', accountant_category: 'Lodging' })).toBe('Parking & Lodging');
  });
  it('never overwrites a specific category', () => {
    expect(canonicalSyncTarget({ category: 'Tires', accountant_category: 'Repairs' })).toBeNull();
    expect(canonicalSyncTarget({ category: 'Truck Parts', accountant_category: 'Equipment/Operating Supplies' })).toBeNull();
  });
  it('offers nothing for Laundry/Showers, Misc or no accountant category', () => {
    expect(canonicalSyncTarget({ category: 'Misc', accountant_category: 'Laundry/Showers' })).toBeNull();
    expect(canonicalSyncTarget({ category: 'Other', accountant_category: 'Misc' })).toBeNull();
    expect(canonicalSyncTarget({ category: 'Misc', accountant_category: null })).toBeNull();
    expect(canonicalSyncTarget({ category: 'Misc', accountant_category: 'Not a category' })).toBeNull();
  });
});

const TRUCK = 't1';
function ded(id: string, amount: number, category: string, accountant: string | null, source = 'manual'): Deduction {
  return {
    id,
    user_id: 'u1',
    truck_id: TRUCK,
    ded_date: '2026-08-18',
    amount,
    category,
    accountant_category: accountant,
    source,
    description: `${category} ${id}`,
    payment_method: 'Business Checking',
    tax_deductible: true,
    settlement_id: null,
  } as unknown as Deduction;
}

describe('isolation proof: applying every out-of-sync row moves only category breakdowns', () => {
  const rows: Deduction[] = [
    ded('a', 85, 'Misc', 'Lumpers'),
    ded('b', 12.5, 'Other', 'Cash Tolls/Parking Fees'),
    ded('c', 40, 'Misc', 'Equipment/Operating Supplies'),
    ded('d', 66.3, 'Misc', 'Safety/Weather Gear'),
    ded('e', 120, 'Misc', 'Cash Fuel'),
    ded('f', 18.99, 'Misc', 'Oil & Additives'),
    ded('g', 25, 'Misc', 'Truck & Trailer Wash'),
    ded('h', 3100, 'Misc', 'Repairs'),
    ded('i', 70, 'Misc', 'Communication'),
    ded('j', 9.99, 'Misc', 'Advertising'),
    ded('k', 14.2, 'Misc', 'Office Supplies'),
    ded('l', 95, 'Misc', 'Lodging'),
    ded('m', 8, 'Misc', 'Laundry/Showers'),
    ded('n', 3.5, 'Misc', 'Bank/ATM Fees'),
    ded('o', 44, 'Tires', 'Repairs'),
    ded('w', 100, 'Escrow & Deposits', null, 'settlement'),
  ];
  const settlements = [
    { id: 's1', truck_id: TRUCK, week_ending: '2026-08-21', gross: 4783.75, net: 1884.73, miles: 2327, carrier: 'Prime Inc' },
  ];

  const kpis = (deductions: Deduction[]) =>
    computeKpis({
      trucks: [{ id: TRUCK, unit_number: '283940' }] as never,
      settlements: settlements as never,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      reimbursements: [],
      truckScope: TRUCK,
      window: { startIso: '2026-08-15', endIso: '2026-08-21' },
    });
  const taxInput = (deductions: Deduction[]) =>
    deductions.filter((d) => d.source !== 'settlement' && reducesTrueProfit(d)).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  const sync = findCategoriesOutOfSync(rows);
  const after = rows.map((d) => {
    const s = sync.find((x) => x.id === d.id);
    return s ? ({ ...d, category: s.to } as Deduction) : d;
  });

  it('offers 13 rows (not Laundry/Showers, not the specific Tires row, not the withheld row)', () => {
    expect(sync.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'n']);
    expect(after.find((d) => d.id === 'o')!.category).toBe('Tires');
    expect(after.every((d, i) => d.accountant_category === rows[i].accountant_category)).toBe(true);
    expect(after.every((d, i) => d.amount === rows[i].amount && d.tax_deductible === rows[i].tax_deductible)).toBe(true);
  });

  it('totals, profit, CPM, RPM, PPM and the tax input are identical', () => {
    const before = kpis(rows);
    const k = kpis(after);
    expect(k.gross).toBeCloseTo(before.gross, 10);
    expect(k.expenses.total).toBeCloseTo(before.expenses.total, 10);
    expect(k.net).toBeCloseTo(before.net, 10);
    expect(k.rpm).toBeCloseTo(before.rpm!, 10);
    expect(k.cpm).toBeCloseTo(before.cpm!, 10);
    expect(k.ppm).toBeCloseTo(before.ppm!, 10);
    expect(taxInput(after)).toBeCloseTo(taxInput(rows), 10);
  });
});
