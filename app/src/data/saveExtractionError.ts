// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02, device feedback:
// "settlement imports failing frequently"). Every meaningful write step in
// saveExtraction() (aiImportSave.ts) now throws a SaveExtractionError
// instead of a bare Error/PostgrestError — the import screen can then show
// EXACTLY which step failed (upload / documents row / settlement row /
// which child table's insert / the business-balance RPC / ...) plus the
// underlying Postgres error's message/code/hint/details, instead of one
// generic "save failed" that hides where things actually went wrong.
//
// `partial` answers item 4's "state exactly what was and wasn't saved":
// once the settlement row itself exists, a later step failing (a child
// insert, the old-batch cleanup, the balance RPC) does NOT mean nothing
// was saved — the settlement and however many child rows succeeded before
// the failure are already durably in Postgres (each Supabase call commits
// independently; there is no single transaction wrapping the whole save,
// a known limitation tracked as a v1.1 "full RPC transaction for imports"
// backlog item, PROMPTS.md). Showing the user what's ALREADY there avoids
// a duplicate/confused re-import attempt.
export type SaveExtractionStep =
  | 'validation'
  | 'storage-upload'
  | 'documents-insert'
  | 'settlements-lookup'
  | 'settlements-save'
  | 'reimport-lookup'
  | 'loads-insert'
  | 'fuel-insert'
  | 'deductions-insert'
  | 'reimbursements-insert'
  | 'maintenance-insert'
  | 'tolls-insert'
  | 'loans-upsert'
  | 'driver-payment-insert'
  | 'reimport-cleanup'
  | 'balance-update'
  | 'fuel-standalone-insert'
  | 'financial-doc-insert'
  | 'compliance-lookup'
  | 'compliance-save'
  | 'maintenance-standalone-insert'
  | 'maintenance-warranty-reimbursement-insert'
  | 'purchase-deduction-insert'
  | 'capital-transaction-insert'
  | 'loan-agreement-insert'
  | 'asset-link-lookup'
  | 'asset-link-update'
  | 'generic-deduction-insert'
  | 'equipment-link-insert';

export type SaveExtractionPartialState = {
  documentId: string | null;
  storagePath: string | null;
  settlementId: string | null;
  settlementSaved: boolean;
  childRowsSaved: boolean;
  oldRowsCleanedUp: boolean;
  balanceUpdated: boolean;
};

export function emptyPartialState(): SaveExtractionPartialState {
  return {
    documentId: null,
    storagePath: null,
    settlementId: null,
    settlementSaved: false,
    childRowsSaved: false,
    oldRowsCleanedUp: false,
    balanceUpdated: false,
  };
}

type PgErrorShape = { message?: string; code?: string; hint?: string; details?: string };

function extractCauseMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause) return String((cause as PgErrorShape).message);
  return String(cause);
}

export class SaveExtractionError extends Error {
  step: SaveExtractionStep;
  cause: unknown;
  partial: SaveExtractionPartialState;
  code: string | null;
  hint: string | null;
  details: string | null;
  // POSTGRES UNIQUE-VIOLATION RACE (settlements_user_week_truck_uidx /
  // settlements_user_week_notruck_uidx, docs/PENDING_SQL.md §34): the
  // client already checks findExistingSettlement() before deciding
  // insert-vs-update, but that check-then-act isn't atomic — a double-tap
  // on Save, or two devices importing the same account's same week/truck
  // within the same instant, can still race past the check and hit the
  // unique index on INSERT. This is a distinguishable, actionable case
  // (not a generic DB failure) — flagged so the UI can say "this week was
  // just imported — check Settlements before retrying" instead of a
  // scary raw constraint-violation message.
  isDuplicateSettlementRace: boolean;

  constructor(step: SaveExtractionStep, cause: unknown, partial: SaveExtractionPartialState) {
    super(extractCauseMessage(cause));
    this.name = 'SaveExtractionError';
    this.step = step;
    this.cause = cause;
    this.partial = partial;
    const pg = (cause ?? {}) as PgErrorShape;
    this.code = pg.code ?? null;
    this.hint = pg.hint ?? null;
    this.details = pg.details ?? null;
    this.isDuplicateSettlementRace = step === 'settlements-save' && pg.code === '23505';
  }
}

export function isSaveExtractionError(err: unknown): err is SaveExtractionError {
  return err instanceof SaveExtractionError;
}

// Human-readable label per step — used both by the import screen's error
// card and the "Copy Details" report. Deliberately describes WHERE in the
// pipeline things broke, in plain language a non-developer can act on
// (retry vs. "this isn't something retrying will fix").
export const STEP_LABELS: Record<SaveExtractionStep, string> = {
  validation: 'Checking the document before saving',
  'storage-upload': 'Uploading the file',
  'documents-insert': 'Saving the document record',
  'settlements-lookup': 'Checking for an existing settlement this week',
  'settlements-save': 'Saving the settlement',
  'reimport-lookup': "Looking up last week's saved records (re-import)",
  'loads-insert': 'Saving loads',
  'fuel-insert': 'Saving fuel purchases',
  'deductions-insert': 'Saving withheld deductions',
  'reimbursements-insert': 'Saving reimbursements',
  'maintenance-insert': 'Saving maintenance records',
  'tolls-insert': 'Saving tolls',
  'loans-upsert': 'Saving loan/financing records',
  'driver-payment-insert': "Saving the driver's settlement split",
  'reimport-cleanup': "Removing last week's replaced records",
  'balance-update': 'Updating your business balance',
  'fuel-standalone-insert': 'Saving the fuel purchase',
  'financial-doc-insert': 'Saving the expense',
  'compliance-lookup': 'Checking for an existing compliance record',
  'compliance-save': 'Saving the compliance record',
  'maintenance-standalone-insert': 'Saving the maintenance record',
  'maintenance-warranty-reimbursement-insert': 'Saving the warranty reimbursement',
  'purchase-deduction-insert': 'Saving the purchase',
  'capital-transaction-insert': 'Saving the owner contribution',
  'loan-agreement-insert': 'Saving the loan/financing agreement',
  'asset-link-lookup': 'Looking up trucks/equipment to link the loan',
  'asset-link-update': 'Linking the loan to a truck/trailer/equipment',
  'generic-deduction-insert': 'Saving the record',
  'equipment-link-insert': 'Saving the linked equipment record',
};

// Builds the full "Copy Details" report text — one shared format so a
// device bug report always has the same shape regardless of which step
// failed. Deliberately plain, unlocalized diagnostic text (same
// "diagnostic text is never localized" precedent as ScreenErrorBoundary's
// own copy-report — error.message/stack are always shown raw there too).
export function buildErrorReport(err: SaveExtractionError, buildLine: string): string {
  const { partial } = err;
  const savedParts: string[] = [];
  if (partial.documentId) savedParts.push('document record');
  if (partial.settlementSaved) savedParts.push('settlement row');
  if (partial.childRowsSaved) savedParts.push('loads/fuel/deductions/reimbursements');
  if (partial.oldRowsCleanedUp) savedParts.push("previous week's data replaced");
  if (partial.balanceUpdated) savedParts.push('business balance updated');

  return [
    `Build: ${buildLine}`,
    `Failed step: ${STEP_LABELS[err.step]} (${err.step})`,
    `Error: ${err.message}`,
    err.code ? `Code: ${err.code}` : null,
    err.hint ? `Hint: ${err.hint}` : null,
    err.details ? `Details: ${err.details}` : null,
    `What was already saved: ${savedParts.length > 0 ? savedParts.join(', ') : 'nothing yet'}`,
    partial.documentId ? `Document ID: ${partial.documentId}` : null,
    partial.settlementId ? `Settlement ID: ${partial.settlementId}` : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}
