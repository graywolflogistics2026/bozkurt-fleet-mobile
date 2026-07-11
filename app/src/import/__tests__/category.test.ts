import {
  applyScheduleCDefault,
  CANONICAL_CATEGORIES,
  DEFAULT_SCHEDULE_C_BUCKET,
  detectMaintType,
  getCatNote,
  guessCategory,
  isPersonalPayment,
  mergeCategoryOptions,
  toDbServiceType,
} from '@/src/import/category';
import type { UserCategory } from '@/src/types/db';

function userCategory(overrides: Partial<UserCategory>): UserCategory {
  return {
    id: 'uc1',
    user_id: 'u1',
    name: 'Custom',
    kind: 'expense',
    schedule_c_bucket: 'Misc',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isPersonalPayment', () => {
  it('matches personal/cash/zelle/venmo payment methods', () => {
    expect(isPersonalPayment('Personal Card')).toBe(true);
    expect(isPersonalPayment('Personal Checking')).toBe(true);
    expect(isPersonalPayment('Personal Credit Card')).toBe(true);
    expect(isPersonalPayment('Cash')).toBe(true);
    expect(isPersonalPayment('Cash App')).toBe(true);
    expect(isPersonalPayment('Zelle Personal')).toBe(true);
    expect(isPersonalPayment('Venmo')).toBe(true);
    expect(isPersonalPayment('Venmo Personal')).toBe(true);
  });

  it('does not match business payment methods', () => {
    expect(isPersonalPayment('Business Credit')).toBe(false);
    expect(isPersonalPayment('Business Debit')).toBe(false);
    expect(isPersonalPayment('Business Checking')).toBe(false);
    expect(isPersonalPayment('Business Credit Card')).toBe(false);
    expect(isPersonalPayment(undefined)).toBe(false);
  });

  it('reads "Zelle Business" as business-paid despite matching /zelle/i (the NOT-business guard)', () => {
    expect(isPersonalPayment('Zelle Business')).toBe(false);
  });
});

describe('guessCategory', () => {
  it('tags legal/accounting/drug-consortium as Professional Services (renamed 2026-07-10)', () => {
    expect(guessCategory('Abacus bookkeeping fee', '')).toBe('Professional Services');
    expect(guessCategory('Drug and alcohol consortium fee', '')).toBe('Professional Services');
  });

  it('tags ELD brands as ELD & Communications, distinct from Software & Subscriptions (industry knowledge base, owner decision 2026-07-10)', () => {
    expect(guessCategory('Motive ELD subscription', '')).toBe('ELD & Communications');
    expect(guessCategory('Samsara device fee', '')).toBe('ELD & Communications');
  });

  it('still tags non-ELD software/load-board services as Software & Subscriptions', () => {
    expect(guessCategory('GitHub Copilot subscription', '')).toBe('Software & Subscriptions');
    expect(guessCategory('DAT load board subscription', '')).toBe('Software & Subscriptions');
  });

  it('tags tools before electronics for power-tool brands', () => {
    expect(guessCategory('Milwaukee M18 impact wrench', 'Home Depot')).toBe('Tools & Equipment');
  });

  it('falls back to a store default when the item name is generic', () => {
    expect(guessCategory('Widget', 'Home Depot')).toBe('Tools & Equipment');
  });

  it('falls back to Misc when nothing matches', () => {
    expect(guessCategory('Assorted item', 'Some Random Store')).toBe('Misc');
  });

  it('tags Truck Supplies & Equipment / Safety Gear & Workwear (renamed 2026-07-10)', () => {
    expect(guessCategory('Fire extinguisher', '')).toBe('Truck Supplies & Equipment');
    expect(guessCategory('LED work light', '')).toBe('Safety Gear & Workwear');
  });

  it('distinguishes Insurance—Health from Insurance—Truck (industry knowledge base, owner decision 2026-07-10)', () => {
    expect(guessCategory('Health insurance premium', '')).toBe('Insurance—Health');
    expect(guessCategory('Truck liability insurance premium', '')).toBe('Insurance—Truck');
  });

  it('tags Permits, Licenses & Road Taxes with the expanded IRS/state keyword list', () => {
    expect(guessCategory('IFTA quarterly fee', '')).toBe('Permits, Licenses & Road Taxes');
    expect(guessCategory('Form 2290 HVUT payment', '')).toBe('Permits, Licenses & Road Taxes');
  });

  it('recognizes brand hints (docs/INDUSTRY_TAXONOMY.md §C)', () => {
    expect(guessCategory('Comdata fuel card fee', '')).toBe('Fuel & DEF');
    expect(guessCategory('PrePass toll fee', '')).toBe('Tolls & Scales');
    expect(guessCategory('OOIDA membership renewal', '')).toBe('Association Dues');
    expect(guessCategory('Gusto payroll fee', '')).toBe('Wages & Payroll Taxes (W-2)');
    expect(guessCategory('Triumph factoring fee', '')).toBe('Dispatch & Factoring Fees');
  });

  it('tags tires, parking/lodging, and office/admin (new canonical categories)', () => {
    expect(guessCategory('New drive tires', '')).toBe('Tires');
    expect(guessCategory('Motel overnight stay', '')).toBe('Parking & Lodging');
    expect(guessCategory('Office supplies and printer paper', '')).toBe('Office & Admin');
  });
});

describe('getCatNote', () => {
  it('returns the category-specific note', () => {
    expect(getCatNote('Tools & Equipment')).toBe('Truck maintenance/repair tool');
  });

  it('returns the renamed-category notes (industry knowledge base, owner decision 2026-07-10)', () => {
    expect(getCatNote('Truck Supplies & Equipment')).toBe('Truck operating supply — business expense');
    expect(getCatNote('Safety Gear & Workwear')).toBe('Safety equipment — truck operations');
  });

  it('falls back to a generic business-expense note', () => {
    expect(getCatNote('Some Unknown Category')).toBe('Business expense — OTR truck driver');
  });
});

describe('detectMaintType', () => {
  it('detects oil changes', () => {
    expect(detectMaintType('Full synthetic oil change and filter')).toBe('oil');
  });

  it('detects coolant extender specifically (not full coolant)', () => {
    expect(detectMaintType('Coolant extender service')).toBe('coolext');
  });

  it('falls back to general', () => {
    expect(detectMaintType('Some unrelated repair')).toBe('general');
  });
});

describe('toDbServiceType', () => {
  it('remaps legacy "coolext" to the schema\'s "coolant_ext" category', () => {
    expect(toDbServiceType('coolext')).toBe('coolant_ext');
  });

  it('passes every other type through unchanged', () => {
    for (const t of ['oil', 'fuel', 'dpf', 'def', 'coolant', 'trans', 'diff', 'airfilter', 'airdryer', 'chassis', 'apu', 'tires', 'brakes', 'general']) {
      expect(toDbServiceType(t)).toBe(t);
    }
  });
});

describe('mergeCategoryOptions (custom categories, owner decision 2026-07-10)', () => {
  it('merges CANONICAL_CATEGORIES with active custom expense categories', () => {
    const custom = [userCategory({ name: 'Detention Software', kind: 'expense' })];
    const result = mergeCategoryOptions('expense', custom);
    expect(result).toEqual([...CANONICAL_CATEGORIES, 'Detention Software']);
  });

  it('excludes inactive custom categories', () => {
    const custom = [userCategory({ name: 'Retired Category', kind: 'expense', active: false })];
    expect(mergeCategoryOptions('expense', custom)).toEqual([...CANONICAL_CATEGORIES]);
  });

  it('excludes custom categories of the wrong kind', () => {
    const custom = [userCategory({ name: 'Referral Bonus', kind: 'income' })];
    expect(mergeCategoryOptions('expense', custom)).toEqual([...CANONICAL_CATEGORIES]);
  });

  it('de-dupes a custom name that collides with an existing canonical category', () => {
    const custom = [userCategory({ name: 'Tires', kind: 'expense' })];
    const result = mergeCategoryOptions('expense', custom);
    expect(result.filter((c) => c === 'Tires')).toHaveLength(1);
  });

  it('income has no canonical list — only the user\'s own active custom income categories', () => {
    const custom = [
      userCategory({ id: 'uc1', name: 'Referral Bonus', kind: 'income', schedule_c_bucket: null }),
      userCategory({ id: 'uc2', name: 'Inactive Income', kind: 'income', schedule_c_bucket: null, active: false }),
      userCategory({ id: 'uc3', name: 'Some Expense', kind: 'expense' }),
    ];
    expect(mergeCategoryOptions('income', custom)).toEqual(['Referral Bonus']);
  });

  it('returns just the canonical list when there are no custom categories', () => {
    expect(mergeCategoryOptions('expense', [])).toEqual([...CANONICAL_CATEGORIES]);
    expect(mergeCategoryOptions('income', [])).toEqual([]);
  });
});

describe('applyScheduleCDefault (tax safety rail, owner decision 2026-07-10)', () => {
  it('defaults schedule_c_bucket to "Misc" for an expense category with none given', () => {
    const result = applyScheduleCDefault({ user_id: 'u1', name: 'New Category', kind: 'expense' });
    expect(result.schedule_c_bucket).toBe(DEFAULT_SCHEDULE_C_BUCKET);
  });

  it('preserves an explicit schedule_c_bucket for an expense category', () => {
    const result = applyScheduleCDefault({
      user_id: 'u1',
      name: 'New Category',
      kind: 'expense',
      schedule_c_bucket: 'Tires',
    });
    expect(result.schedule_c_bucket).toBe('Tires');
  });

  it('forces schedule_c_bucket to null for an income category, even if one was passed in', () => {
    const result = applyScheduleCDefault({
      user_id: 'u1',
      name: 'Referral Bonus',
      kind: 'income',
      schedule_c_bucket: 'Misc',
    });
    expect(result.schedule_c_bucket).toBeNull();
  });
});
