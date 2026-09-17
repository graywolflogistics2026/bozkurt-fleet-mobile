import { CANONICAL_CATEGORIES } from '@/src/import/category';
import { matchesAccountantScope } from '@/src/stats/accountantPackage';
import {
  CANONICAL_TO_ACCOUNTANT_CATEGORY,
  isEligibleForAccountantReport,
  suggestAccountantCategory,
  findUnmappedCanonicalCategories,
  findAccountantCategoryBackfillCandidates,
  type BackfillCandidateRow,
} from '@/src/primeDriverExpenses/categoryMapping';

// THE ORIGIN RULE — the single most important constraint in this whole
// task (owner decision 2026-09-17, "CRITICAL ACCURACY TASK"). This is
// deliberately the VERY FIRST test in this file: a row is ONLY eligible
// for an accountant_category, and ONLY eligible to ever appear on the
// "For Prime Inc Drivers" report, if it is genuinely out-of-pocket —
// regardless of what its canonical category name is or what that name
// maps to. Two rows, both categorized "Truck Wash & Detailing" (which
// DOES map to "Truck & Trailer Wash" below) — one settlement-withheld,
// one out-of-pocket. Only the out-of-pocket one may ever get an
// accountant_category.
describe('THE ORIGIN RULE — checked first, independently of category, no exceptions', () => {
  it('a settlement-withheld "Truck Wash & Detailing" row is never eligible, even though the category itself maps to "Truck & Trailer Wash"', () => {
    const withheldRow = { category: 'Truck Wash & Detailing', source: 'settlement' };
    const outOfPocketRow = { category: 'Truck Wash & Detailing', source: 'manual' };

    // Origin alone decides eligibility — category name is irrelevant to
    // this check.
    expect(isEligibleForAccountantReport(withheldRow.source)).toBe(false);
    expect(isEligibleForAccountantReport(outOfPocketRow.source)).toBe(true);

    // The suggestion function is where the two checks (origin, then
    // category) actually compose — the withheld row must get `null`
    // regardless of its category mapping to a real accountant category;
    // the out-of-pocket row must get the real mapped value.
    expect(suggestAccountantCategory(withheldRow.category, withheldRow.source)).toBeNull();
    expect(suggestAccountantCategory(outOfPocketRow.category, outOfPocketRow.source)).toBe('Truck & Trailer Wash');
  });

  it('the origin check is IDENTICAL to matchesAccountantScope()\'s own out-of-pocket definition — the two can never drift apart', () => {
    for (const source of ['settlement', 'import', 'manual', null, undefined] as const) {
      expect(isEligibleForAccountantReport(source)).toBe(matchesAccountantScope(source, 'outOfPocket'));
    }
  });

  it('an unmapped category is still correctly rejected for a withheld row, and still correctly unmapped for an out-of-pocket one', () => {
    expect(suggestAccountantCategory('Insurance—Truck', 'settlement')).toBeNull();
    expect(suggestAccountantCategory('Insurance—Truck', 'manual')).toBeNull(); // no approved mapping either way
  });

  it('a null/undefined category is never eligible regardless of origin', () => {
    expect(suggestAccountantCategory(null, 'manual')).toBeNull();
    expect(suggestAccountantCategory(undefined, 'manual')).toBeNull();
  });
});

describe('CANONICAL_TO_ACCOUNTANT_CATEGORY — the owner-approved mapping table, verbatim', () => {
  it('every one of the real CANONICAL_CATEGORIES has an explicit entry (even if null) — no future category can silently fall through', () => {
    expect(findUnmappedCanonicalCategories()).toEqual([]);
    for (const category of CANONICAL_CATEGORIES) {
      expect(Object.prototype.hasOwnProperty.call(CANONICAL_TO_ACCOUNTANT_CATEGORY, category)).toBe(true);
    }
  });

  it('matches the exact owner-approved mapping table for every explicitly-mapped category', () => {
    const expected: Record<string, string | null> = {
      'Fuel & DEF': 'Cash Fuel',
      'Fuel Additives': 'Oil & Additives',
      'Maintenance & Repairs': 'Repairs',
      'Major Repairs & Overhauls': 'Repairs',
      'Truck Parts': 'Repairs',
      Tires: 'Repairs',
      'Truck Wash & Detailing': 'Truck & Trailer Wash',
      'Truck/Trailer Payments': null,
      'Insurance—Truck': null,
      'Insurance—Health': null,
      'Permits, Licenses & Road Taxes': null,
      'Tolls & Scales': 'Cash Tolls/Parking Fees',
      'Parking & Lodging': 'Lodging',
      'ELD & Communications': 'Communication',
      'Software & Subscriptions': null,
      'Dispatch & Factoring Fees': null,
      'Legal & Professional Services': null,
      'Office & Admin': 'Office Supplies',
      'Safety Gear & Workwear': 'Safety/Weather Gear',
      'Truck Supplies & Equipment': 'Equipment/Operating Supplies',
      'Tools & Equipment': 'Equipment/Operating Supplies',
      Electronics: 'Equipment/Operating Supplies',
      'Comfort & Sleeper': 'Equipment/Operating Supplies',
      'Warranty & Service Contracts': null,
      'Lumper Fees': 'Lumpers',
      'Contract Labor (1099)': null,
      'Wages & Payroll Taxes (W-2)': null,
      'Bank & Merchant Fees': 'Bank/ATM Fees',
      Advertising: 'Advertising',
      'Training & Education': null,
      'Association Dues': null,
      'Lease & Rent': null,
      'Utilities & Subscriptions': null,
      'Meals (per diem covered)': null,
      'Advance Repayment': null,
      'Escrow & Deposits': null,
      Misc: 'Misc',
      Other: 'Misc',
    };
    expect(CANONICAL_TO_ACCOUNTANT_CATEGORY).toEqual(expected);
  });
});

describe('findAccountantCategoryBackfillCandidates — historical backfill, always editable', () => {
  it('proposes a value for an eligible, unmapped out-of-pocket row', () => {
    const rows: BackfillCandidateRow[] = [{ id: 'd1', category: 'Fuel & DEF', source: 'manual', accountant_category: null }];
    expect(findAccountantCategoryBackfillCandidates(rows)).toEqual([{ id: 'd1', accountantCategory: 'Cash Fuel' }]);
  });

  it('NEVER overwrites a row that already has a non-null accountant_category — whether auto-set before or manually corrected', () => {
    const rows: BackfillCandidateRow[] = [
      { id: 'd1', category: 'Fuel & DEF', source: 'manual', accountant_category: 'Misc' }, // user manually corrected away from the suggested value
      { id: 'd2', category: 'Lumper Fees', source: 'manual', accountant_category: 'Lumpers' }, // already auto-set by an earlier backfill run
    ];
    expect(findAccountantCategoryBackfillCandidates(rows)).toEqual([]);
  });

  it('never proposes a value for a settlement-withheld row, regardless of category', () => {
    const rows: BackfillCandidateRow[] = [{ id: 'd1', category: 'Truck Wash & Detailing', source: 'settlement', accountant_category: null }];
    expect(findAccountantCategoryBackfillCandidates(rows)).toEqual([]);
  });

  it('never proposes a value for a category with no approved mapping', () => {
    const rows: BackfillCandidateRow[] = [{ id: 'd1', category: 'Insurance—Truck', source: 'manual', accountant_category: null }];
    expect(findAccountantCategoryBackfillCandidates(rows)).toEqual([]);
  });

  it('is idempotent/safe to re-run — running it twice on its own output produces no further candidates', () => {
    const rows: BackfillCandidateRow[] = [
      { id: 'd1', category: 'Fuel & DEF', source: 'manual', accountant_category: null },
      { id: 'd2', category: 'Insurance—Truck', source: 'manual', accountant_category: null },
    ];
    const firstPass = findAccountantCategoryBackfillCandidates(rows);
    expect(firstPass).toHaveLength(1);
    const rowsAfterApplying = rows.map((r) => {
      const applied = firstPass.find((c) => c.id === r.id);
      return applied ? { ...r, accountant_category: applied.accountantCategory } : r;
    });
    expect(findAccountantCategoryBackfillCandidates(rowsAfterApplying)).toEqual([]);
  });
});
