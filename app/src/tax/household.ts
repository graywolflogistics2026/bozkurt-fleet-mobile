import type { HouseholdIncome } from '@/src/types/db';

// Feeds calcTaxEstimate.ts's `spouseIncome` input (legacy's single
// "Spouse Income" field, generalized here to sum every household_income
// row for the resolved tax year — not just a 'spouse' relation, since a
// household can have 'child'/'other' income sources too, docs/SCHEMA.sql).
// Only rows matching the estimate's own tax year count; a prior/future
// year's entries must never leak into this year's AGI.
export function sumHouseholdIncome(rows: HouseholdIncome[], taxYear: number): number {
  return rows.filter((r) => r.tax_year === taxYear).reduce((sum, r) => sum + Number(r.annual_amount ?? 0), 0);
}
