import {
  applyScheduleCDefault,
  CANONICAL_CATEGORIES,
  CHARGEBACK_CATEGORY_LABEL,
  classifySettlementLine,
  DEFAULT_SCHEDULE_C_BUCKET,
  defaultTaxDeductible,
  detectMaintType,
  getCatNote,
  guessCategory,
  isEscrowDeposit,
  isFuelAdditive,
  isGenericAdvance,
  isInsuranceChargeback,
  isLodging,
  isLumperFee,
  isMajorRepairOverhaul,
  isPersonalPayment,
  isRestaurantPurchase,
  isTruckPart,
  isTruckWash,
  isWarrantyService,
  mergeCategoryOptions,
  NON_DEDUCTIBLE_CATEGORIES,
  SCHEDULE_C_LINE,
  scheduleCLineFor,
  toDbServiceType,
} from '@/src/import/category';
import type { UserCategory } from '@/src/types/db';
import { findCarrierCodeMatch } from '@/src/import/carrierCodes';
import type { CarrierCode } from '@/src/import/carrierCodes';

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
  it('tags legal/accounting/drug-consortium as Legal & Professional Services (renamed 2026-08-05, Schedule C Line 17 wording)', () => {
    expect(guessCategory('Abacus bookkeeping fee', '')).toBe('Legal & Professional Services');
    expect(guessCategory('Drug and alcohol consortium fee', '')).toBe('Legal & Professional Services');
  });

  it('tags ELD brands as ELD & Communications, distinct from Software & Subscriptions (industry knowledge base, owner decision 2026-07-10)', () => {
    expect(guessCategory('Motive ELD subscription', '')).toBe('ELD & Communications');
    expect(guessCategory('Samsara device fee', '')).toBe('ELD & Communications');
  });

  it('still tags non-ELD software as Software & Subscriptions', () => {
    expect(guessCategory('GitHub Copilot subscription', '')).toBe('Software & Subscriptions');
  });

  it('tags GPS/load-board services as ELD & Communications (owner decision 2026-08-05, FULL PARITY pass)', () => {
    expect(guessCategory('DAT load board subscription', '')).toBe('ELD & Communications');
    expect(guessCategory('Garmin GPS unit', '')).toBe('ELD & Communications');
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

describe('isRestaurantPurchase (meals & advance repayments, owner decision 2026-07-17)', () => {
  it('matches known restaurant/food-purchase names', () => {
    expect(isRestaurantPurchase('Waffle House')).toBe(true);
    expect(isRestaurantPurchase("Bob's Bar & Grill")).toBe(true);
    expect(isRestaurantPurchase('Pilot Travel Center Restaurant')).toBe(true);
    expect(isRestaurantPurchase('Downtown Diner')).toBe(true);
    expect(isRestaurantPurchase('Taco Bell drive-thru')).toBe(true);
  });

  it('does NOT match a truck GRILLE part (equipment, never a meal)', () => {
    expect(isRestaurantPurchase('Freightliner Cascadia grille assembly')).toBe(false);
    expect(isRestaurantPurchase('Chrome grille insert')).toBe(false);
    expect(isRestaurantPurchase('Front grille bracket')).toBe(false);
  });

  it('returns false for unrelated/empty text', () => {
    expect(isRestaurantPurchase('Milwaukee Drill')).toBe(false);
    expect(isRestaurantPurchase(undefined)).toBe(false);
  });
});

describe('isEscrowDeposit (escrow & deposits, owner decision 2026-08-02)', () => {
  it('matches a correctly-spelled performance bond/escrow/reserve line', () => {
    expect(isEscrowDeposit('Performance Bond')).toBe(true);
    expect(isEscrowDeposit('Escrow Reserve')).toBe(true);
    expect(isEscrowDeposit('Maintenance Reserve')).toBe(true);
    expect(isEscrowDeposit('Tire Fund')).toBe(true);
    expect(isEscrowDeposit('Emergency Fund')).toBe(true);
  });

  it('matches the real, OCR-damaged spelling this rule was verified against', () => {
    expect(isEscrowDeposit('PERFORMNCE BOND')).toBe(true);
  });

  it('does not match a bare "bond" or "security deposit" (a different, existing concept)', () => {
    expect(isEscrowDeposit('Surety Bond Co.')).toBe(false);
    expect(isEscrowDeposit('Security Deposit')).toBe(false);
  });

  it('returns false for unrelated/empty text', () => {
    expect(isEscrowDeposit('Milwaukee Drill')).toBe(false);
    expect(isEscrowDeposit(undefined)).toBe(false);
  });
});

describe('isInsuranceChargeback (Cash Flow auto-fill fix, owner decision 2026-08-04)', () => {
  it('matches the exact real carrier line codes from the device report', () => {
    expect(isInsuranceChargeback('BT/DH INS')).toBe(true);
    expect(isInsuranceChargeback('PHY DAM')).toBe(true);
    expect(isInsuranceChargeback('OCCUP ACC')).toBe(true);
    expect(isInsuranceChargeback('CARGO')).toBe(true);
    expect(isInsuranceChargeback('WORKERS COMP')).toBe(true);
  });

  it('matches spelled-out variants and generic insurance wording', () => {
    expect(isInsuranceChargeback('Physical Damage')).toBe(true);
    expect(isInsuranceChargeback('Occupational Accident')).toBe(true);
    expect(isInsuranceChargeback('Workers Compensation')).toBe(true);
    expect(isInsuranceChargeback('Bobtail Insurance')).toBe(true);
    expect(isInsuranceChargeback('Weekly Insurance Premium')).toBe(true);
    expect(isInsuranceChargeback('Insurance Policy')).toBe(true);
  });

  it('returns false for unrelated/empty text', () => {
    expect(isInsuranceChargeback('Milwaukee Drill')).toBe(false);
    expect(isInsuranceChargeback('Fuel Advance')).toBe(false);
    expect(isInsuranceChargeback(undefined)).toBe(false);
  });
});

describe('guessCategory restaurant detection (meals & advance repayments, owner decision 2026-07-17)', () => {
  it('tags a restaurant store name as Meals (per diem covered)', () => {
    expect(guessCategory('Combo #3', 'Waffle House')).toBe('Meals (per diem covered)');
  });

  it('does not misclassify a truck grille part as a meal', () => {
    expect(guessCategory('Freightliner Cascadia grille assembly', 'AutoZone')).toBe('Tools & Equipment');
  });
});

describe('defaultTaxDeductible (meals & advance repayments, owner decision 2026-07-17; escrow & deposits, owner decision 2026-08-02)', () => {
  it('is false for Meals (per diem covered), Advance Repayment, and Escrow & Deposits', () => {
    expect(defaultTaxDeductible('Meals (per diem covered)')).toBe(false);
    expect(defaultTaxDeductible('Advance Repayment')).toBe(false);
    expect(defaultTaxDeductible('Escrow & Deposits')).toBe(false);
  });

  it('NON_DEDUCTIBLE_CATEGORIES contains exactly these three', () => {
    expect([...NON_DEDUCTIBLE_CATEGORIES].sort()).toEqual(
      ['Advance Repayment', 'Escrow & Deposits', 'Meals (per diem covered)'].sort()
    );
  });

  it('CANONICAL_CATEGORIES includes Escrow & Deposits', () => {
    expect((CANONICAL_CATEGORIES as readonly string[]).includes('Escrow & Deposits')).toBe(true);
  });

  it('CHARGEBACK_CATEGORY_LABEL maps escrow_reserve to Escrow & Deposits', () => {
    expect(CHARGEBACK_CATEGORY_LABEL.escrow_reserve).toBe('Escrow & Deposits');
  });

  it('is true for every other category, including null/undefined', () => {
    expect(defaultTaxDeductible('Fuel & DEF')).toBe(true);
    expect(defaultTaxDeductible('Misc')).toBe(true);
    expect(defaultTaxDeductible(null)).toBe(true);
    expect(defaultTaxDeductible(undefined)).toBe(true);
  });
});

describe('FULL PARITY pass discrimination rules (owner decision 2026-08-05)', () => {
  it('isFuelAdditive matches additive brands/wording, not bare fuel purchases', () => {
    expect(isFuelAdditive('Howes Diesel Treat')).toBe(true);
    expect(isFuelAdditive('Power Service Diesel Kleen')).toBe(true);
    expect(isFuelAdditive("Hot Shot's Secret Diesel Extreme")).toBe(true);
    expect(isFuelAdditive('Lucas Oil Fuel Treatment')).toBe(true);
    expect(isFuelAdditive('Archoil AR6200')).toBe(true);
    expect(isFuelAdditive('Anti-gel additive')).toBe(true);
    expect(isFuelAdditive('Pilot diesel fuel purchase')).toBe(false);
  });

  it('isTruckPart matches consumed parts, distinct from Tools & Equipment', () => {
    expect(isTruckPart('Alternator replacement')).toBe(true);
    expect(isTruckPart('Battery - Group 31')).toBe(true);
    expect(isTruckPart('Serpentine belt')).toBe(true);
    expect(isTruckPart('Air dryer cartridge')).toBe(true);
    expect(isTruckPart('Wiper blades')).toBe(true);
    expect(isTruckPart('Milwaukee M18 impact wrench')).toBe(false);
  });

  it('isTruckWash matches wash/detail, guarded against "washer fluid"', () => {
    expect(isTruckWash('Truck wash')).toBe(true);
    expect(isTruckWash('Full detailing service')).toBe(true);
    expect(isTruckWash('Windshield washer fluid')).toBe(false);
  });

  it('isWarrantyService matches spelled-out generic wording only — a carrier-specific code like "EXTEND WR PURCH" is out of scope (CARRIER ISOLATION, see carrier_code_maps instead)', () => {
    expect(isWarrantyService('EXTEND WR PURCH')).toBe(false);
    expect(isWarrantyService('Extended warranty')).toBe(true);
    expect(isWarrantyService('Service contract')).toBe(true);
    expect(isWarrantyService('Milwaukee Drill')).toBe(false);
  });

  it('isLumperFee matches "ADV FOR OUTSIDE LUMPER" and bare "lumper"', () => {
    expect(isLumperFee('ADV FOR OUTSIDE LUMPER')).toBe(true);
    expect(isLumperFee('Lumper fee')).toBe(true);
    expect(isLumperFee('Milwaukee Drill')).toBe(false);
  });

  it('isGenericAdvance matches a plain ADVANCE/ADV line', () => {
    expect(isGenericAdvance('ADVANCE')).toBe(true);
    expect(isGenericAdvance('ADV')).toBe(true);
    expect(isGenericAdvance('Milwaukee Drill')).toBe(false);
  });

  it('isMajorRepairOverhaul requires BOTH the >$2,500 threshold AND a major-component keyword', () => {
    expect(isMajorRepairOverhaul('Engine in-frame overhaul', 8000)).toBe(true);
    expect(isMajorRepairOverhaul('Transmission rebuild', 3200)).toBe(true);
    expect(isMajorRepairOverhaul('Differential rebuild', 2600)).toBe(true);
    // Below the threshold — stays a normal repair, even with matching wording.
    expect(isMajorRepairOverhaul('Engine in-frame overhaul', 2000)).toBe(false);
    // Above the threshold but not a major-component keyword.
    expect(isMajorRepairOverhaul('Oil change', 3000)).toBe(false);
  });

  it('isLodging matches inn/lodge/Airbnb/truck-parking, guarded against "Inner tube"', () => {
    expect(isLodging('Hampton Inn')).toBe(true);
    expect(isLodging("Trucker's Lodge")).toBe(true);
    expect(isLodging('Airbnb stay')).toBe(true);
    expect(isLodging('Truck parking reservation')).toBe(true);
    expect(isLodging('Inner tube')).toBe(false);
  });

  it('SCHEDULE_C_LINE / scheduleCLineFor covers every canonical category with a defensible line', () => {
    for (const category of CANONICAL_CATEGORIES) {
      expect(scheduleCLineFor(category)).toBe(SCHEDULE_C_LINE[category]);
    }
    expect(scheduleCLineFor('Legal & Professional Services')).toBe('17');
    expect(scheduleCLineFor('Insurance—Truck')).toBe('15');
    expect(scheduleCLineFor('Maintenance & Repairs')).toBe('21');
    expect(scheduleCLineFor('Major Repairs & Overhauls')).toBe('21*');
    // Non-Schedule-C categories map to null, not a fabricated line number.
    expect(scheduleCLineFor('Insurance—Health')).toBeNull();
    expect(scheduleCLineFor('Meals (per diem covered)')).toBeNull();
    expect(scheduleCLineFor('Escrow & Deposits')).toBeNull();
  });
});

describe('classifySettlementLine (settlement-line classifier, owner decision 2026-08-05, FULL PARITY pass)', () => {
  it('classifies the generic, carrier-neutral settlement codes from the spec', () => {
    expect(classifySettlementLine('MAYFR BT/DH INS')).toBe('Insurance—Truck');
    expect(classifySettlementLine('PHY DAM')).toBe('Insurance—Truck');
    expect(classifySettlementLine('OCCUP ACC')).toBe('Insurance—Truck');
    expect(classifySettlementLine('FED HWY TAX')).toBe('Permits, Licenses & Road Taxes');
    expect(classifySettlementLine('LICENSE/PERMITS')).toBe('Permits, Licenses & Road Taxes');
    expect(classifySettlementLine('QUAL RENTAL')).toBe('ELD & Communications');
    expect(classifySettlementLine('GEO RENTAL')).toBe('ELD & Communications');
    expect(classifySettlementLine('NAVIGATION CHARGE')).toBe('ELD & Communications');
    expect(classifySettlementLine('PrePass')).toBe('Tolls & Scales');
    expect(classifySettlementLine('Drivewyze')).toBe('Tolls & Scales');
    expect(classifySettlementLine('PERFORMNCE BOND')).toBe('Escrow & Deposits');
    expect(classifySettlementLine('COMPANY STORE')).toBe('Truck Supplies & Equipment');
    expect(classifySettlementLine('WIRE FEE')).toBe('Bank & Merchant Fees');
    expect(classifySettlementLine('MERCHANT FEE')).toBe('Bank & Merchant Fees');
    expect(classifySettlementLine('ADV FOR OUTSIDE LUMPER')).toBe('Lumper Fees');
  });

  // CARRIER ISOLATION (CLAUDE.md hard invariant) — every one of these is a
  // real carrier's own internal abbreviated code TEXT (Prime Inc's, in every
  // case observed so far), not a generic concept — classifySettlementLine()
  // must never resolve any of them; that's carrier_code_maps' job
  // (app/src/import/carrierCodes.ts, docs/PENDING_SQL.md §53), scoped to the
  // carrier that actually issued the statement.
  it('CARRIER ISOLATION: no carrier-specific code fragment leaks into the generic classifier', () => {
    const carrierSpecificFragments = [
      'EXTEND WR PURCH',
      'ACCOUNTING SERV',
      'IMAGE TRIPS',
      'EZ FAST LN',
      'WIRE CHARGE',
      'FUEL CARD CHARGE',
      'TRIP XPRESS',
      'STATEMENT PREPARATION',
      'PRIME POINT-OF-SALE',
    ];
    for (const fragment of carrierSpecificFragments) {
      expect(classifySettlementLine(fragment)).toBeNull();
    }
  });

  it('the same carrier-specific fragments DO resolve once scoped to the carrier that owns them', () => {
    const codes: CarrierCode[] = [
      { carrier: 'PRIME INC', code: 'EXTEND WR PURCH', subCode: null, label: 'Extended Warranty Purchase', description: null, category: 'Warranty & Service Contracts', isDeductible: true, incomeOrChargeback: 'chargeback', notes: null },
      { carrier: 'PRIME INC', code: 'ACCOUNTING SERV', subCode: null, label: 'Accounting Service', description: null, category: 'Legal & Professional Services', isDeductible: true, incomeOrChargeback: 'chargeback', notes: null },
      { carrier: 'PRIME INC', code: 'EZ FAST LN', subCode: null, label: 'EZ Fast Lane Toll', description: null, category: 'Tolls & Scales', isDeductible: true, incomeOrChargeback: 'chargeback', notes: null },
    ];
    for (const [text, expected] of [
      ['EXTEND WR PURCH', 'Warranty & Service Contracts'],
      ['ACCOUNTING SERV', 'Legal & Professional Services'],
      ['EZ FAST LN', 'Tolls & Scales'],
    ] as const) {
      // classifySettlementLine() itself never resolves these (proven above);
      // the carrier-scoped lookup (which mapExtraction.ts's mapSettlement()
      // actually runs FIRST, before ever falling back to
      // classifySettlementLine()) is what resolves them, and only for the
      // carrier that owns them.
      expect(classifySettlementLine(text)).toBeNull();
      const match = findCarrierCodeMatch('PRIME INC', text, codes);
      expect(match?.category).toBe(expected);
      expect(findCarrierCodeMatch('SOME OTHER CARRIER', text, codes)).toBeNull();
    }
  });

  it('ORDER MATTERS: a plain ADVANCE line is non-deductible repayment, beating the warranty rule', () => {
    expect(classifySettlementLine('ADVANCE')).toBe('Advance Repayment');
    expect(classifySettlementLine('ADV')).toBe('Advance Repayment');
  });

  it('ORDER MATTERS: a lumper advance stays deductible despite containing "ADV"', () => {
    expect(classifySettlementLine('ADV FOR OUTSIDE LUMPER')).toBe('Lumper Fees');
    expect(classifySettlementLine('ADV OUTSIDE LUMPER')).toBe('Lumper Fees');
  });

  it('the generic, spelled-out warranty wording (no carrier code abbreviation) is still deductible', () => {
    expect(classifySettlementLine('Extended warranty purchase')).toBe('Warranty & Service Contracts');
  });

  it('returns null for an unrecognized line, falling through to chargebackType/category', () => {
    expect(classifySettlementLine('Some Unrecognized Code')).toBeNull();
    expect(classifySettlementLine(undefined)).toBeNull();
  });
});

describe('UNIFIED CLASSIFICATION PATH (owner decision) — classifySettlementLine() and guessCategory() agree', () => {
  // Regression guard for the exact bug that motivated the unification:
  // classifySettlementLine() recognized IRP/IFTA/HVUT/2290 while
  // guessCategory() (or vice versa) did not, for Permits and ELD
  // specifically — plus 3 more categories that had the identical
  // divergence risk (Tolls & Scales, Bank & Merchant Fees, Legal &
  // Professional Services) even though nobody had reported them yet.
  // Each description below is chosen to be unambiguous under BOTH
  // functions' own (different) rule orderings — it must not accidentally
  // match an earlier-checked category in either one.
  const sharedCategoryCases: Array<[string, string]> = [
    ['IRP', 'Permits, Licenses & Road Taxes'],
    ['IFTA quarterly filing', 'Permits, Licenses & Road Taxes'],
    ['HVUT payment', 'Permits, Licenses & Road Taxes'],
    ['Form 2290', 'Permits, Licenses & Road Taxes'],
    ['ELD FEE', 'ELD & Communications'],
    ['Weigh station fee', 'Tolls & Scales'],
    ['Merchant fee', 'Bank & Merchant Fees'],
    ['Bookkeeping service', 'Legal & Professional Services'],
  ];

  it.each(sharedCategoryCases)('classifySettlementLine(%j) and guessCategory(%j, undefined) agree on %j', (desc, expected) => {
    expect(classifySettlementLine(desc)).toBe(expected);
    expect(guessCategory(desc, undefined)).toBe(expected);
  });

  it('the exact reported bug (IRP recognized by one function, not the other) is fixed both ways', () => {
    // Before this fix: classifySettlementLine('IRP') was null (its own
    // FED_HWY_TAX_RE never listed "irp"), while guessCategory already
    // recognized it — proving they used to disagree on the SAME text.
    expect(classifySettlementLine('IRP')).toBe(guessCategory('IRP', undefined));
    expect(classifySettlementLine('IRP')).toBe('Permits, Licenses & Road Taxes');
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
