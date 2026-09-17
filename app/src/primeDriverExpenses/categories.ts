// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner decision,
// 2026-09-17) — a brand-new, standalone screen that exists ONLY to match
// the exact monthly report format the user's accountant already uses.
// This is deliberately a SEPARATE category vocabulary from
// `app/src/import/category.ts`'s `CANONICAL_CATEGORIES` — never merged
// with it, never fed into it. These 16 values are the accountant's own
// fixed template wording, not a Schedule C taxonomy; a future edit to
// CANONICAL_CATEGORIES must never touch this list, and vice versa.
//
// DOMAIN VALUE, NEVER TRANSLATED (CLAUDE.md invariant #11's own "domain
// values stay English in every locale" rule — same treatment as the 9
// fixed payment-method strings in `app/src/import/paymentMethods.ts`):
// these are plain English literals, not i18n keys. An accountant working
// from a fixed English template needs the exact same 16 words on every
// exported report regardless of which language the app itself is
// displayed in.
export const PRIME_DRIVER_EXPENSE_CATEGORIES = [
  'Lumpers',
  'Cash Tolls/Parking Fees',
  'Scales',
  'Equipment/Operating Supplies',
  'Safety/Weather Gear',
  'Cash Fuel',
  'Oil & Additives',
  'Truck & Trailer Wash',
  'Repairs',
  'Communication',
  'Advertising',
  'Office Supplies',
  'Lodging',
  'Laundry/Showers',
  'Bank/ATM Fees',
  'Misc',
] as const;

export type PrimeDriverExpenseCategory = (typeof PRIME_DRIVER_EXPENSE_CATEGORIES)[number];

export function isPrimeDriverExpenseCategory(value: string): value is PrimeDriverExpenseCategory {
  return (PRIME_DRIVER_EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
