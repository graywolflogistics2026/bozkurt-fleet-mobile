import { CANONICAL_CATEGORIES } from '@/src/import/category';
import { matchesAccountantScope } from '@/src/stats/accountantPackage';
import {
  CANONICAL_TO_ACCOUNTANT_CATEGORY,
  isEligibleForAccountantReport,
  suggestAccountantCategory,
  findUnmappedCanonicalCategories,
  findAccountantCategoryBackfillCandidates,
  findRowsNeedingAccountantCategory,
  isInAccountantReportScope,
  isVehicleAssetOrRegistration,
  AMBIGUOUS_ACCOUNTANT_CATEGORIES,
  findLumperReimbursementGaps,
  isWithheldLumperAdvance,
  diagnoseLumperDeductions,
  type BackfillCandidateRow,
  type LumperReimbursementRow,
  type ExistingLumperDeductionRow,
  type LumperDeductionRow,
} from '@/src/primeDriverExpenses/categoryMapping';
import { eligibleDeductionRowsForReport } from '@/src/stats/primeDriverExpenses';

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
      Tires: null,
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
      'Utilities & Subscriptions': 'Communication',
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

// LUMPER PAYMENTS MISSING FROM THE REPORT (owner decision 2026-09-19, bug
// investigation). Confirmed root cause: a lumper fee the driver pays
// personally, then gets reimbursed for through a settlement's own
// reimbursementItems section, never created a matching deductions row
// anywhere in this app — reimbursements has no category column. These
// tests prove the diagnostic surfaces real rows correctly AND the
// historical-gap detector only ever proposes a genuinely missing
// companion, never a duplicate.
describe('diagnoseLumperDeductions — the per-row eligibility breakdown', () => {
  it('an out-of-pocket, correctly-categorized, correctly-suggested row is eligible', () => {
    const rows: LumperDeductionRow[] = [
      {
        id: 'd1',
        description: 'Outside lumper at Walmart DC',
        amount: 75,
        ded_date: '2026-06-01',
        category: 'Lumper Fees',
        source: 'import',
        accountant_category: 'Lumpers',
      },
    ];
    expect(diagnoseLumperDeductions(rows)).toEqual([
      {
        id: 'd1',
        description: 'Outside lumper at Walmart DC',
        amount: 75,
        ded_date: '2026-06-01',
        category: 'Lumper Fees',
        source: 'import',
        accountant_category: 'Lumpers',
        eligible: true,
        reason: 'eligible',
      },
    ]);
  });

  // PRIME LUMPER EXCEPTION (owner decision 2026-09-23): a withheld lumper
  // line from a Prime settlement IS on the report (under Lumpers); one
  // from a known non-Prime carrier's settlement is still excluded.
  it('a settlement-withheld lumper row (H1) is on the report via the Prime lumper exception, unless its settlement is a known non-Prime carrier', () => {
    const rows: LumperDeductionRow[] = [
      { id: 'd1', settlement_id: 's1', description: 'LM LUMPER UNLOAD', amount: 50, ded_date: '2026-06-01', category: 'Lumper Fees', source: 'settlement', accountant_category: null },
    ];
    const prime = diagnoseLumperDeductions(rows);
    expect(prime[0].eligible).toBe(true);
    expect(prime[0].reason).toBe('prime_settlement_lumper');
    const nonPrime = diagnoseLumperDeductions(rows, new Set(['s1']));
    expect(nonPrime[0].eligible).toBe(false);
    expect(nonPrime[0].reason).toBe('excluded_settlement_withheld');
  });

  it('a category-name mismatch (H2) — the description names a lumper but the saved category is something else — is flagged distinctly from an origin exclusion', () => {
    const rows: LumperDeductionRow[] = [
      { id: 'd1', description: 'Outside lumper fee', amount: 60, ded_date: '2026-06-01', category: 'Misc', source: 'manual', accountant_category: null },
    ];
    const diag = diagnoseLumperDeductions(rows);
    expect(diag[0].eligible).toBe(false);
    expect(diag[0].reason).toBe('category_mismatch');
  });

  it('an out-of-pocket row correctly categorized but not yet backfilled (H3) is flagged distinctly', () => {
    const rows: LumperDeductionRow[] = [
      { id: 'd1', description: 'Outside lumper fee', amount: 60, ded_date: '2026-06-01', category: 'Lumper Fees', source: 'manual', accountant_category: null },
    ];
    const diag = diagnoseLumperDeductions(rows);
    expect(diag[0].eligible).toBe(false);
    expect(diag[0].reason).toBe('missing_accountant_category');
  });

  it('a row that neither names a lumper nor is categorized Lumper Fees is excluded from the diagnosis entirely, not flagged as any reason', () => {
    const rows: LumperDeductionRow[] = [
      { id: 'd1', description: 'Truck wash', amount: 30, ded_date: '2026-06-01', category: 'Truck Wash & Detailing', source: 'manual', accountant_category: null },
    ];
    expect(diagnoseLumperDeductions(rows)).toEqual([]);
  });

  it('a genuine advance-repaid lumper-shaped line (an ADV line without the word lumper) is not swept into the diagnosis by description alone', () => {
    // classifySettlementLine() resolves this to 'Advance Repayment', never
    // 'Lumper Fees' — and its own description contains no "lumper" text,
    // so diagnoseLumperDeductions() correctly has nothing to say about it.
    const rows: LumperDeductionRow[] = [
      { id: 'd1', description: 'ADVANCE REPAYMENT WK3', amount: 40, ded_date: '2026-06-01', category: 'Advance Repayment', source: 'settlement', accountant_category: null },
    ];
    expect(diagnoseLumperDeductions(rows)).toEqual([]);
  });
});

describe('findLumperReimbursementGaps — the confirmed historical root cause', () => {
  it('a lumper-shaped reimbursement with no matching out-of-pocket deduction is a real gap', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for outside lumper', amount: 65, reimb_date: '2026-06-01' },
    ];
    expect(findLumperReimbursementGaps(reimbursements, [])).toEqual([
      { reimbursementId: 'r1', description: 'Reimbursement for outside lumper', amount: 65, date: '2026-06-01' },
    ]);
  });

  it('a non-lumper reimbursement (tolls/scales/washout) is never flagged — scope is Lumper Fees specifically', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for tolls', amount: 20, reimb_date: '2026-06-01' },
    ];
    expect(findLumperReimbursementGaps(reimbursements, [])).toEqual([]);
  });

  it('a lumper reimbursement that already has a matching out-of-pocket deduction (same date+amount) is NOT flagged again', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for outside lumper', amount: 65, reimb_date: '2026-06-01' },
    ];
    const existing: ExistingLumperDeductionRow[] = [{ amount: 65, ded_date: '2026-06-01', category: 'Lumper Fees', source: 'import' }];
    expect(findLumperReimbursementGaps(reimbursements, existing)).toEqual([]);
  });

  it('a SETTLEMENT-WITHHELD lumper deduction sharing the same date+amount never counts as an existing companion — only an out-of-pocket one does', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for outside lumper', amount: 65, reimb_date: '2026-06-01' },
    ];
    // A withheld chargeback happening to share this date/amount is a
    // DIFFERENT transaction (money never left the driver's pocket) — it
    // must never be mistaken for the reimbursement's own companion.
    const existing: ExistingLumperDeductionRow[] = [{ amount: 65, ded_date: '2026-06-01', category: 'Lumper Fees', source: 'settlement' }];
    expect(findLumperReimbursementGaps(reimbursements, existing)).toEqual([
      { reimbursementId: 'r1', description: 'Reimbursement for outside lumper', amount: 65, date: '2026-06-01' },
    ]);
  });

  it('is idempotent — running it again after the gap has been filled in finds nothing left to create', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for outside lumper', amount: 65, reimb_date: '2026-06-01' },
    ];
    const gaps = findLumperReimbursementGaps(reimbursements, []);
    expect(gaps).toHaveLength(1);
    const afterCreating: ExistingLumperDeductionRow[] = gaps.map((g) => ({
      amount: g.amount,
      ded_date: g.date,
      category: 'Lumper Fees',
      source: 'import',
    }));
    expect(findLumperReimbursementGaps(reimbursements, afterCreating)).toEqual([]);
  });

  it('THE FULL MIXED SCENARIO (item 4) — out-of-pocket, settlement-withheld, advance-repaid, and a reimbursement gap, all in one realistic dataset', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', description: 'Reimbursement for outside lumper', amount: 65, reimb_date: '2026-06-08' },
    ];
    const existingDeductions: ExistingLumperDeductionRow[] = [
      { amount: 50, ded_date: '2026-06-01', category: 'Lumper Fees', source: 'settlement' }, // withheld — not a companion for anything
      { amount: 40, ded_date: '2026-06-15', category: 'Advance Repayment', source: 'settlement' }, // advance-repaid, not even category Lumper Fees
    ];
    expect(findLumperReimbursementGaps(reimbursements, existingDeductions)).toEqual([
      { reimbursementId: 'r1', description: 'Reimbursement for outside lumper', amount: 65, date: '2026-06-08' },
    ]);
  });
});

// Real lines from the owner's own Prime settlements.
// Prime lumper advances are shown on the report automatically (read live
// by eligibleDeductionRowsForReport(), owner decision 2026-09-23 — see
// src/stats/__tests__/primeDriverExpenses.test.ts) — so the banner, which
// only ADDS missing out-of-pocket rows, must never also offer them, or
// they'd be counted twice. They also never get an accountant_category.
describe('Prime lumper advances are never banner items (no double count)', () => {
  const primeAdvances = [
    { id: 'd1', settlement_id: 's0717', description: 'ADV FOR OUTSIDE LUMPER', amount: 217.55, ded_date: '2026-07-17', category: 'Lumper Fees', source: 'settlement', accountant_category: null },
    { id: 'd2', settlement_id: 's0731', description: 'ADV FOR OUTSIDE LUMPER', amount: 328.54, ded_date: '2026-07-31', category: 'Lumper Fees', source: 'settlement', accountant_category: null },
    { id: 'd3', settlement_id: 's0731', description: 'ADV FOR OUTSIDE LUMPER', amount: 216.0, ded_date: '2026-07-31', category: 'Lumper Fees', source: 'settlement', accountant_category: null },
  ];

  it('is never an accountant_category backfill candidate (the banner\'s "uncategorized" source)', () => {
    expect(findAccountantCategoryBackfillCandidates(primeAdvances)).toEqual([]);
  });

  it('is recognized as a withheld lumper advance, by category or by description', () => {
    for (const d of primeAdvances) expect(isWithheldLumperAdvance(d)).toBe(true);
    expect(isWithheldLumperAdvance({ category: 'Advance Repayment', description: 'ADV FOR OUTSIDE LUMPER', source: 'settlement' })).toBe(true);
    expect(isWithheldLumperAdvance({ category: 'Lumper Fees', description: 'Lumper at dock', source: 'manual' })).toBe(false);
  });

  it('vetoes a lumper reimbursement on the SAME settlement as a withheld lumper advance', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r1', settlement_id: 's0731', description: 'OUTSIDE LUMPER', amount: 327.54, reimb_date: '2026-07-31' },
    ];
    expect(findLumperReimbursementGaps(reimbursements, primeAdvances)).toEqual([]);
  });

  it('still surfaces a lumper reimbursement on a settlement with NO lumper advance (driver paid cash)', () => {
    const reimbursements: LumperReimbursementRow[] = [
      { id: 'r2', settlement_id: 's0807', description: 'OUTSIDE LUMPER', amount: 150, reimb_date: '2026-08-07' },
    ];
    expect(findLumperReimbursementGaps(reimbursements, primeAdvances)).toEqual([
      { reimbursementId: 'r2', description: 'OUTSIDE LUMPER', amount: 150, date: '2026-08-07' },
    ]);
  });

  it('the diagnostic panel labels each advance as on the report (Prime settlement lumper)', () => {
    expect(diagnoseLumperDeductions(primeAdvances).map((d) => d.reason)).toEqual([
      'prime_settlement_lumper',
      'prime_settlement_lumper',
      'prime_settlement_lumper',
    ]);
  });
});

// UTILITIES & SUBSCRIPTIONS -> COMMUNICATION (owner decision 2026-09-23).
describe('Utilities & Subscriptions maps to Communication', () => {
  it('an out-of-pocket Utilities & Subscriptions row gets Communication; a settlement-withheld one gets nothing', () => {
    expect(suggestAccountantCategory('Utilities & Subscriptions', 'manual')).toBe('Communication');
    expect(suggestAccountantCategory('Utilities & Subscriptions', 'import')).toBe('Communication');
    expect(suggestAccountantCategory('Utilities & Subscriptions', 'settlement')).toBeNull();
  });

  it('the backfill fills a blank Utilities row but never overwrites one set by hand', () => {
    const rows: BackfillCandidateRow[] = [
      { id: 'blank', category: 'Utilities & Subscriptions', source: 'manual', accountant_category: null },
      { id: 'handSet', category: 'Utilities & Subscriptions', source: 'manual', accountant_category: 'Misc' },
      { id: 'withheld', category: 'Utilities & Subscriptions', source: 'settlement', accountant_category: null },
    ];
    expect(findAccountantCategoryBackfillCandidates(rows)).toEqual([{ id: 'blank', accountantCategory: 'Communication' }]);
  });
});

// "NEEDS A CATEGORY" — NARROWED TO AN EXPLICIT ALLOWLIST (owner decision
// 2026-09-23). This screen is a cash expense record for out-of-pocket
// expenses that belong in the 16 accountant categories, plus Prime
// settlement lumpers. Nothing else is ever shown or flagged.
describe('screen scope — ambiguous allowlist and permanently out-of-scope categories', () => {
  const row = (
    id: string,
    category: string | null,
    source = 'manual',
    accountant_category: string | null = null,
    description: string | null = id,
    ded_date = '2026-07-10'
  ) => ({ id, ded_date, amount: 100, description, category, source, accountant_category });

  it('the allowlist is exactly Tires and Warranty & Service Contracts, both suggesting Repairs, with no automatic mapping', () => {
    expect(AMBIGUOUS_ACCOUNTANT_CATEGORIES).toEqual({ Tires: 'Repairs', 'Warranty & Service Contracts': 'Repairs' });
    expect(suggestAccountantCategory('Tires', 'manual')).toBeNull();
    expect(suggestAccountantCategory('Warranty & Service Contracts', 'manual')).toBeNull();
  });

  it('ITEM 6: an out-of-pocket Insurance—Truck expense never appears anywhere on this screen — not in the needs list, not in the report, even with an accountant category already set', () => {
    const blank = row('ins-blank', 'Insurance—Truck');
    const alreadySet = row('ins-set', 'Insurance—Truck', 'manual', 'Misc');
    expect(findRowsNeedingAccountantCategory([blank, alreadySet])).toEqual([]);
    expect(eligibleDeductionRowsForReport([blank, alreadySet])).toEqual([]);
  });

  it('ITEM 6: an out-of-pocket Tires expense DOES appear in the needs list (the genuine ambiguous case), and on the report once a category is picked', () => {
    const tires = row('tires', 'Tires', 'import');
    expect(findRowsNeedingAccountantCategory([tires]).map((r) => r.id)).toEqual(['tires']);
    expect(eligibleDeductionRowsForReport([tires])).toEqual([]);
    const picked = { ...tires, accountant_category: 'Repairs' };
    expect(findRowsNeedingAccountantCategory([picked])).toEqual([]);
    expect(eligibleDeductionRowsForReport([picked]).map((r) => r.category)).toEqual(['Repairs']);
    // Only accountant_category changed — the canonical category is untouched.
    expect(picked.category).toBe('Tires');
  });

  it('ITEM 6: a vehicle registration fee never appears on this screen, whatever category it was filed under', () => {
    const rows = [
      row('reg-permits', 'Permits, Licenses & Road Taxes', 'manual', null, 'TX vehicle registration fee'),
      row('reg-misc', 'Misc', 'manual', 'Misc', 'Truck registration and license plate renewal'),
      row('title-other', 'Other', 'import', 'Misc', 'Title application fee 2026'),
      row('downpayment', 'Misc', 'manual', 'Misc', 'Down payment on truck'),
      row('plate-tires', 'Tires', 'manual', null, 'IRP apportioned plate fee'),
    ];
    expect(findRowsNeedingAccountantCategory(rows)).toEqual([]);
    expect(eligibleDeductionRowsForReport(rows)).toEqual([]);
    for (const r of rows) expect(isVehicleAssetOrRegistration(r.description)).toBe(true);
  });

  it('a Truck Parts row mentioning a fifth-wheel plate is NOT mistaken for a plate fee', () => {
    expect(isVehicleAssetOrRegistration('Fifth wheel plate grease')).toBe(false);
    expect(eligibleDeductionRowsForReport([row('fw', 'Truck Parts', 'manual', 'Repairs', 'Fifth wheel plate grease')])).toHaveLength(1);
  });

  it('every permanently out-of-scope category (plus custom and missing categories) is never listed and never reported', () => {
    const outOfScope = [
      'Insurance—Truck',
      'Insurance—Health',
      'Permits, Licenses & Road Taxes',
      'Software & Subscriptions',
      'Dispatch & Factoring Fees',
      'Legal & Professional Services',
      'Contract Labor (1099)',
      'Wages & Payroll Taxes (W-2)',
      'Training & Education',
      'Association Dues',
      'Lease & Rent',
      'Meals (per diem covered)',
      'Advance Repayment',
      'Escrow & Deposits',
      'Truck/Trailer Payments',
      'My Own Custom Category',
      null,
    ];
    for (const category of outOfScope) {
      expect(isInAccountantReportScope(category, 'x')).toBe(false);
      const blank = row('b', category);
      const set = row('s', category, 'manual', 'Misc');
      expect(findRowsNeedingAccountantCategory([blank, set])).toEqual([]);
      expect(eligibleDeductionRowsForReport([blank, set])).toEqual([]);
    }
  });

  it('every automatically mapped category plus the allowlist is in scope, and nothing else among the canonical categories', () => {
    const inScope = CANONICAL_CATEGORIES.filter((c) => isInAccountantReportScope(c, 'x')).sort();
    const expected = [
      ...Object.entries(CANONICAL_TO_ACCOUNTANT_CATEGORY)
        .filter(([, v]) => v !== null)
        .map(([k]) => k),
      ...Object.keys(AMBIGUOUS_ACCOUNTANT_CATEGORIES),
    ]
      .filter((c) => (CANONICAL_CATEGORIES as readonly string[]).includes(c))
      .sort();
    expect(inScope).toEqual(expected);
  });

  it('a settlement-withheld Tires row is never in the needs list (origin rule first)', () => {
    expect(findRowsNeedingAccountantCategory([row('t', 'Tires', 'settlement')])).toEqual([]);
  });

  it('a Tires row never assigned stays in the list on every visit, newest first alongside Warranty', () => {
    const rows = [
      row('old-tires', 'Tires', 'manual', null, 'Steer tire', '2026-05-01'),
      row('warranty', 'Warranty & Service Contracts', 'import', null, 'Extended warranty', '2026-08-01'),
    ];
    expect(findRowsNeedingAccountantCategory(rows).map((r) => r.id)).toEqual(['warranty', 'old-tires']);
    expect(findRowsNeedingAccountantCategory(rows).map((r) => r.id)).toEqual(['warranty', 'old-tires']);
  });
});
