import { CANONICAL_CATEGORIES } from '@/src/import/category';
import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';

// MAP EXISTING OUT-OF-POCKET DEDUCTIONS INTO THE 16 ACCOUNTANT CATEGORIES
// (owner decision 2026-09-17, "CRITICAL ACCURACY TASK" — Step 1 mapping
// table reviewed and approved by the owner BEFORE any of this file was
// written; do not change this mapping without a fresh owner decision).
//
// THE ORIGIN RULE — read this before touching anything in this file: this
// mapping table answers ONLY "which of the 16 accountant categories does
// canonical category X belong in, once a row has already been confirmed
// out-of-pocket." It says NOTHING about whether a row qualifies in the
// first place. A row's ORIGIN (out-of-pocket vs. settlement-withheld) is
// checked FIRST, independently of category, via isEligibleForAccountantReport()
// below — reusing the EXACT SAME signal
// `src/stats/accountantPackage.ts`'s `matchesAccountantScope()` already
// established for its own out-of-pocket scope (`origin === 'settlement'`
// means withheld), never a second, competing definition. A settlement-
// withheld "Truck Wash & Detailing" row must NEVER receive an
// accountant_category and must NEVER appear on the "For Prime Inc
// Drivers" report, even though "Truck Wash & Detailing" itself maps to
// "Truck & Trailer Wash" below — category name and origin are two
// independent checks, and origin always wins.
export const CANONICAL_TO_ACCOUNTANT_CATEGORY: Record<string, PrimeDriverExpenseCategory | null> = {
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

// "Scales" and "Laundry/Showers" — 2 of the 16 accountant categories —
// have NO canonical source category mapping to them at all. They're
// reachable only via manual re-categorization on the report itself, or a
// direct `prime_driver_expenses` entry (which never goes through this
// mapping at all).

// A row is eligible for an `accountant_category` and eligible to ever
// appear on the "For Prime Inc Drivers" report ONLY if it's genuinely
// out-of-pocket. Deliberately the SAME check `matchesAccountantScope()`
// (src/stats/accountantPackage.ts) already uses for its own out-of-pocket
// scope — inlined here rather than imported, since importing FROM
// accountantPackage.ts INTO this module would create a two-way coupling
// between the Accountant Package and this unrelated feature; the check
// itself (`origin === 'settlement'` means withheld) is one line and is
// asserted identical to accountantPackage.ts's own version by a dedicated
// test, so the two can never silently drift apart.
export function isEligibleForAccountantReport(source: string | null | undefined): boolean {
  return source !== 'settlement';
}

// The one function every out-of-pocket deduction-insert call site (and
// the historical backfill) uses to decide accountant_category. Returns
// `null` — never a guess — whenever the row isn't eligible at all
// (origin check, first and absolute) or the canonical category has no
// approved mapping. This is a SMART DEFAULT, not a lock: every value it
// returns stays freely editable afterward on the report itself, exactly
// like `tax_deductible`'s own smart-default convention elsewhere in this
// codebase.
export function suggestAccountantCategory(category: string | null | undefined, source: string | null | undefined): PrimeDriverExpenseCategory | null {
  if (!isEligibleForAccountantReport(source)) return null;
  if (!category) return null;
  return CANONICAL_TO_ACCOUNTANT_CATEGORY[category] ?? null;
}

// Regression guard, per this module's own test suite: every one of
// CANONICAL_CATEGORIES' real values must have an explicit entry above
// (even if that entry is `null`) — a future new canonical category added
// to category.ts with no corresponding line here is a detectable gap,
// never a silent fallthrough.
export function findUnmappedCanonicalCategories(): string[] {
  return CANONICAL_CATEGORIES.filter((c) => !(c in CANONICAL_TO_ACCOUNTANT_CATEGORY));
}

export type { PrimeDriverExpenseCategory };
export { PRIME_DRIVER_EXPENSE_CATEGORIES };

export type BackfillCandidateRow = {
  id: string;
  category: string | null;
  source: string | null;
  accountant_category: string | null;
};

export type BackfillCandidate = { id: string; accountantCategory: PrimeDriverExpenseCategory };

// HISTORICAL BACKFILL, ALWAYS EDITABLE (owner decision 2026-09-17) — a
// deliberate, SCOPED exception to this codebase's own standing "never
// auto-assign, always a deliberate user choice" convention (see e.g.
// CLAUDE.md's CUSTOM CATEGORIES invariant #19's own opposite default):
// the owner explicitly asked for accurate automatic placement across
// existing history, correctable afterward, rather than a blank slate to
// fill in by hand row by row. Two guards make this safe to re-run any
// number of times: (1) origin is still checked first via
// suggestAccountantCategory() — a settlement-withheld row is never a
// candidate, full stop; (2) a row that ALREADY has a non-null
// accountant_category (whether set by an earlier run of this same
// backfill, or manually corrected by the user afterward) is never
// touched again — this function only ever fills in a genuinely blank
// value, never overwrites one.
export function findAccountantCategoryBackfillCandidates(rows: BackfillCandidateRow[]): BackfillCandidate[] {
  const candidates: BackfillCandidate[] = [];
  for (const row of rows) {
    if (row.accountant_category) continue;
    const suggested = suggestAccountantCategory(row.category, row.source);
    if (suggested) candidates.push({ id: row.id, accountantCategory: suggested });
  }
  return candidates;
}
