import { groupStepForDisplay } from '@/src/import/errorStepGroups';
import type { SaveExtractionStep } from '@/src/data/saveExtractionError';

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): every granular
// SaveExtractionStep must map to a user-legible display group — a step
// falling through to the generic fallback would show a blank/confusing
// headline on the error card.
const ALL_STEPS: SaveExtractionStep[] = [
  'validation',
  'storage-upload',
  'documents-insert',
  'settlements-lookup',
  'settlements-save',
  'reimport-lookup',
  'loads-insert',
  'fuel-insert',
  'deductions-insert',
  'reimbursements-insert',
  'maintenance-insert',
  'tolls-insert',
  'loans-upsert',
  'driver-payment-insert',
  'reimport-cleanup',
  'balance-update',
  'fuel-standalone-insert',
  'financial-doc-insert',
  'compliance-lookup',
  'compliance-save',
  'maintenance-standalone-insert',
  'maintenance-warranty-reimbursement-insert',
  'purchase-deduction-insert',
  'capital-transaction-insert',
  'loan-agreement-insert',
  'asset-link-lookup',
  'asset-link-update',
  'generic-deduction-insert',
];

describe('groupStepForDisplay', () => {
  it('maps every SaveExtractionStep to a non-empty display group', () => {
    for (const step of ALL_STEPS) {
      expect(groupStepForDisplay(step)).toBeTruthy();
    }
  });

  it('groups every settlement-parent step under savingSettlement', () => {
    expect(groupStepForDisplay('settlements-lookup')).toBe('savingSettlement');
    expect(groupStepForDisplay('settlements-save')).toBe('savingSettlement');
    expect(groupStepForDisplay('reimport-lookup')).toBe('savingSettlement');
  });

  it('groups the RPC failure under updatingBalance, distinct from savingRecords', () => {
    expect(groupStepForDisplay('balance-update')).toBe('updatingBalance');
  });

  it('groups the re-import cleanup step distinctly from a fresh save', () => {
    expect(groupStepForDisplay('reimport-cleanup')).toBe('cleaningUpPreviousWeek');
  });

  it('groups validation as checking', () => {
    expect(groupStepForDisplay('validation')).toBe('checking');
  });
});
