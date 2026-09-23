import { CANONICAL_CATEGORIES, isLumperFee } from '@/src/import/category';
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

// LUMPER PAYMENTS MISSING FROM THE REPORT (owner decision 2026-09-19, bug
// investigation + fix) — DIAGNOSIS, not a guess: read end to end, this
// mapping/backfill/origin-rule/report code was already correct for a
// genuine out-of-pocket `deductions` row (category='Lumper Fees',
// source!=='settlement'). The confirmed root cause found by tracing the
// actual extraction pipeline: a lumper fee the driver pays personally at
// the dock, then gets reimbursed for through the settlement's own
// reimbursementItems section, NEVER created a matching `deductions` row
// at all anywhere in this app — `reimbursements` has no category column,
// so the expense side of that transaction was completely invisible to
// this report (and to the Accountant Package, and to true profit/tax,
// which is a materially bigger correctness gap this same fix closes).
// mapExtraction.ts's mapSettlement() now creates that companion deduction
// automatically for every FUTURE import; this function is the one-time,
// re-runnable HISTORICAL counterpart for reimbursements already saved
// before that fix existed — same "always editable, never silently
// destructive" spirit as findAccountantCategoryBackfillCandidates() above.
export type LumperReimbursementRow = {
  id: string;
  settlement_id?: string | null;
  description: string | null;
  amount: number | null;
  reimb_date: string | null;
};

// The minimal shape needed to detect whether a reimbursement ALREADY has
// a companion out-of-pocket "Lumper Fees" deduction — reimbursements and
// deductions have no direct link column to check by id, so this is a
// deliberately conservative heuristic proxy (same date + same amount):
// false positives (skipping a genuinely-missing companion) are the safe
// failure mode here, never a duplicate.
export type ExistingLumperDeductionRow = {
  settlement_id?: string | null;
  description?: string | null;
  amount: number | null;
  ded_date: string | null;
  category: string | null;
  source: string | null;
};

export type LumperReimbursementGap = {
  reimbursementId: string;
  description: string | null;
  amount: number;
  date: string | null;
};

export function findLumperReimbursementGaps(
  reimbursements: LumperReimbursementRow[],
  existingDeductions: ExistingLumperDeductionRow[]
): LumperReimbursementGap[] {
  const existingLumperOutOfPocket = existingDeductions.filter(
    (d) => d.category === 'Lumper Fees' && isEligibleForAccountantReport(d.source)
  );
  const settlementsWithLumperAdvance = new Set(
    existingDeductions
      .filter((d) => d.settlement_id && isWithheldLumperAdvance({ category: d.category, description: d.description ?? null, source: d.source }))
      .map((d) => d.settlement_id as string)
  );
  const gaps: LumperReimbursementGap[] = [];
  for (const r of reimbursements) {
    if (!isLumperFee(r.description ?? undefined)) continue;
    // Carrier-advanced lumper on the same settlement -> not out-of-pocket.
    if (r.settlement_id && settlementsWithLumperAdvance.has(r.settlement_id)) continue;
    const amount = Number(r.amount ?? 0);
    const hasCompanion = existingLumperOutOfPocket.some(
      (d) => Number(d.amount ?? 0) === amount && (d.ded_date ?? null) === (r.reimb_date ?? null)
    );
    if (hasCompanion) continue;
    gaps.push({ reimbursementId: r.id, description: r.description, amount, date: r.reimb_date });
  }
  return gaps;
}

// A settlement-withheld lumper line (e.g. Prime's "ADV FOR OUTSIDE LUMPER")
// is money the carrier fronted and took back out of the settlement — NEVER
// out-of-pocket (owner decision 2026-09-23, reaffirming the origin rule).
// Used to veto a reimbursement-section lumper on the same settlement: if
// the carrier advanced the lumper, a matching reimbursement is the carrier
// washing its own money, not repaying the driver's cash.
export function isWithheldLumperAdvance(row: { category: string | null; description: string | null; source: string | null }): boolean {
  return !isEligibleForAccountantReport(row.source) && (row.category === 'Lumper Fees' || isLumperFee(row.description ?? undefined));
}

// The full, per-row eligibility breakdown for every deduction that names a
// lumper — whether it resolved to category 'Lumper Fees' directly, or
// (item 2's own explicit hypothesis) fell through to a DIFFERENT category
// string despite its own description clearly naming a lumper, which would
// itself be a real, separate classification bug worth surfacing. Reports
// real row data (id/date/amount/description/category/source/eligibility)
// so a device-side diagnostic can show the user their OWN actual rows —
// this repo has no live database access to run this check remotely, so
// the check itself has to run on the user's own device against their own
// real data, never fabricated.
export type LumperDeductionDiagnosis = {
  id: string;
  description: string | null;
  amount: number | null;
  ded_date: string | null;
  category: string | null;
  source: string | null;
  accountant_category: string | null;
  eligible: boolean;
  reason: 'eligible' | 'excluded_settlement_withheld' | 'category_mismatch' | 'missing_accountant_category';
};

export type LumperDeductionRow = {
  id: string;
  description: string | null;
  amount: number | null;
  ded_date: string | null;
  category: string | null;
  source: string | null;
  accountant_category: string | null;
};

export function diagnoseLumperDeductions(rows: LumperDeductionRow[]): LumperDeductionDiagnosis[] {
  const results: LumperDeductionDiagnosis[] = [];
  for (const row of rows) {
    // Only rows that actually LOOK like a lumper fee (by category OR by
    // description text — item 2's "is the category name mismatched
    // somewhere" check) are included at all.
    const looksLikeLumper = row.category === 'Lumper Fees' || isLumperFee(row.description ?? undefined);
    if (!looksLikeLumper) continue;

    let reason: LumperDeductionDiagnosis['reason'];
    let eligible: boolean;
    if (!isEligibleForAccountantReport(row.source)) {
      reason = 'excluded_settlement_withheld';
      eligible = false;
    } else if (row.category !== 'Lumper Fees') {
      // The description names a lumper but the saved category string is
      // something else entirely — a real classification mismatch, not an
      // origin exclusion.
      reason = 'category_mismatch';
      eligible = false;
    } else if (!row.accountant_category) {
      reason = 'missing_accountant_category';
      eligible = false;
    } else {
      reason = 'eligible';
      eligible = true;
    }

    results.push({
      id: row.id,
      description: row.description,
      amount: row.amount,
      ded_date: row.ded_date,
      category: row.category,
      source: row.source,
      accountant_category: row.accountant_category,
      eligible,
      reason,
    });
  }
  return results;
}
