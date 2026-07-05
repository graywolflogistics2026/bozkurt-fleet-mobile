import { detectMaintType, getCatNote, guessCategory, isPersonalPayment, toDbServiceType } from '@/src/import/category';

describe('isPersonalPayment', () => {
  it('matches personal/cash/zelle/venmo payment methods', () => {
    expect(isPersonalPayment('Personal Card')).toBe(true);
    expect(isPersonalPayment('Cash')).toBe(true);
    expect(isPersonalPayment('Zelle Personal')).toBe(true);
    expect(isPersonalPayment('Venmo Personal')).toBe(true);
  });

  it('does not match business payment methods', () => {
    expect(isPersonalPayment('Business Credit')).toBe(false);
    expect(isPersonalPayment('Business Debit')).toBe(false);
    expect(isPersonalPayment(undefined)).toBe(false);
  });
});

describe('guessCategory', () => {
  it('tags legal/accounting before anything else', () => {
    expect(guessCategory('Abacus bookkeeping fee', '')).toBe('Legal & Accounting Fees');
  });

  it('tags ELD/software services', () => {
    expect(guessCategory('Motive ELD subscription', '')).toBe('Software & Subscriptions');
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
});

describe('getCatNote', () => {
  it('returns the category-specific note', () => {
    expect(getCatNote('Tools & Equipment')).toBe('Truck maintenance/repair tool');
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
