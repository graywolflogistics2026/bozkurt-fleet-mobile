import { sanitizeExtractionDates } from './dateGuard';
import { sanitizeExtractionMiles } from './milesGuard';
import { applyPrimeOperatingStatementCheck } from './settlementStatement';
import type { Extraction } from './types';

// Composes every sanitize-guard in the established order (dates first,
// then miles, then the Prime operating-statement cross-check last, since
// it reads the ALREADY-corrected totalMiles/grossRevenue the miles guard
// may have just fixed). ONE function for every way an extraction reaches
// the preview (owner decision 2026-10-30, before batch D): a live read
// (src/data/aiImportCall.ts — terminal result and partial preview) and a
// background job's stored result_json (src/data/importJobs.ts — the jobs
// list, "Review All", retry, resume, read again). Before this, the job
// path ran only dates + miles and skipped the statement check.
export function sanitizeExtraction(extraction: Extraction): Extraction {
  return applyPrimeOperatingStatementCheck(sanitizeExtractionMiles(sanitizeExtractionDates(extraction)));
}
