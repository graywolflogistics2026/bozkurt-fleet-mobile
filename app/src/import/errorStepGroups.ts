import type { SaveExtractionStep } from '@/src/data/saveExtractionError';

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): SaveExtractionError
// carries one of ~27 granular steps (see saveExtractionError.ts's
// STEP_LABELS, used verbatim/unlocalized in the "Copy Details" report for
// real debugging precision). Translating all 27 into 4 languages for the
// on-screen headline would be a lot of near-duplicate strings for little
// user-facing benefit ("Saving loads" vs "Saving fuel purchases" vs
// "Saving withheld deductions" all mean the same thing to a non-developer:
// "saving your settlement's records") — so the VISIBLE headline groups
// them into these 10 user-meaningful buckets instead, each with its own
// i18n key (importScreen.errorSteps.*). The exact granular step is still
// always in the copyable report for support/debugging.
export type DisplayStepGroup =
  | 'checking'
  | 'uploading'
  | 'savingDocument'
  | 'savingSettlement'
  | 'savingRecords'
  | 'cleaningUpPreviousWeek'
  | 'updatingBalance'
  | 'savingCompliance'
  | 'savingContribution'
  | 'savingLoan';

const GROUP_BY_STEP: Record<SaveExtractionStep, DisplayStepGroup> = {
  validation: 'checking',
  'storage-upload': 'uploading',
  'documents-insert': 'savingDocument',
  'settlements-lookup': 'savingSettlement',
  'settlements-save': 'savingSettlement',
  'reimport-lookup': 'savingSettlement',
  'loads-insert': 'savingRecords',
  'fuel-insert': 'savingRecords',
  'deductions-insert': 'savingRecords',
  'reimbursements-insert': 'savingRecords',
  'maintenance-insert': 'savingRecords',
  'tolls-insert': 'savingRecords',
  'loans-upsert': 'savingRecords',
  'driver-payment-insert': 'savingRecords',
  'reimport-cleanup': 'cleaningUpPreviousWeek',
  'balance-update': 'updatingBalance',
  'fuel-standalone-insert': 'savingRecords',
  'financial-doc-insert': 'savingRecords',
  'compliance-lookup': 'savingCompliance',
  'compliance-save': 'savingCompliance',
  'maintenance-standalone-insert': 'savingRecords',
  'maintenance-warranty-reimbursement-insert': 'savingRecords',
  'purchase-deduction-insert': 'savingRecords',
  'capital-transaction-insert': 'savingContribution',
  'loan-agreement-insert': 'savingLoan',
  'asset-link-lookup': 'savingLoan',
  'asset-link-update': 'savingLoan',
  'generic-deduction-insert': 'savingRecords',
};

export function groupStepForDisplay(step: SaveExtractionStep): DisplayStepGroup {
  return GROUP_BY_STEP[step] ?? 'savingRecords';
}
