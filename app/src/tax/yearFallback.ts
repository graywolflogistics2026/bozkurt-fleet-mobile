import type { TaxYearData } from '@/src/types/db';

export type YearFallbackResult = {
  data: TaxYearData;
  requestedYear: number;
  resolvedYear: number;
  isFallback: boolean;
};

// Pure decision logic extracted from src/data/taxYearData.ts so the
// year-fallback behavior (PROMPTS.md Session 5) is unit-testable without
// mocking Supabase: given the requested year's row (if published) and the
// latest published row as a fallback candidate, decide which one to use.
export function resolveTaxYearData(
  requestedYear: number,
  requestedYearRow: TaxYearData | null,
  latestPublishedRow: TaxYearData | null
): YearFallbackResult {
  if (requestedYearRow) {
    return { data: requestedYearRow, requestedYear, resolvedYear: requestedYear, isFallback: false };
  }
  if (!latestPublishedRow) {
    throw new Error('No published tax_year_data row is available.');
  }
  return {
    data: latestPublishedRow,
    requestedYear,
    resolvedYear: latestPublishedRow.tax_year,
    isFallback: true,
  };
}
