import type { Extraction } from './types';
import { COMPLIANCE_DOC_TYPES, FINANCIAL_DOC_TYPES, GENERIC_DECISION_OUT_OF_SCOPE, mapPurchase } from './mapExtraction';

// USER DECIDES DEDUCTIBILITY (owner decision 2026-11-24,
// docs/decisions/deductible-decision-proposal.md). When a receipt or
// expense document is imported, the AI never decides whether it is tax
// deductible; the user answers Yes or No on the import card, per document
// with a per-item override.
//   - Yes: the row is saved exactly as a deductible import (category the
//     user may change on the card).
//   - No: NO deduction row is written anywhere; the documents row and the
//     stored file still exist (they are written before any expense row).
// Out of scope (today's behaviour, no choice asked): settlements and
// everything derived from them, fuel, maintenance, tolls, driver
// payments, compliance documents, loan agreements, W-2 and other income.

export type ExpenseDecisionPath = 'purchase' | 'financial' | 'generic';

export type ExpenseDecisionRow = {
  deductible: boolean;
  // A category the user picked on the card; null/undefined keeps the
  // mapped (or learned) category, exactly as an import without a choice.
  category?: string | null;
};

// One answer for every row, or one answer per row (in save order).
export type ExpenseDecision = { all: boolean } | { rows: ExpenseDecisionRow[] };

// Which save path of saveExtraction() writes out-of-pocket deduction rows
// for this extraction — mirrors aiImportSave.ts's branch order exactly.
// null = no Yes/No choice (out of scope, or nothing is written).
export function expenseDecisionPath(d: Extraction): ExpenseDecisionPath | null {
  const t = d.docType;
  if (t === 'settlement') return null;
  if (t === 'fuel' && d.fuel) return null;
  if (t === 'driver_payment') return null;
  if ((FINANCIAL_DOC_TYPES as readonly string[]).includes(t) && d.financialDoc) return 'financial';
  if ((COMPLIANCE_DOC_TYPES as readonly string[]).includes(t)) return null;
  if (t === 'maintenance' && d.maintenance) return null;
  if ((t === 'amazon' || t === 'store') && d.purchase) return 'purchase';
  if (t === 'loan_agreement') return null;
  if (t === 'w2' || t === 'government_or_misc_income') return null;
  if (GENERIC_DECISION_OUT_OF_SCOPE.includes(t)) return null;
  return 'generic';
}

// How many deduction rows the document would write (one Yes/No each).
export function expenseRowCount(d: Extraction, userId: string): number {
  const path = expenseDecisionPath(d);
  if (path === null) return 0;
  if (path === 'purchase') return mapPurchase(d, userId).length;
  return 1;
}

export function resolveExpenseRow(decision: ExpenseDecision, index: number): ExpenseDecisionRow | null {
  if ('all' in decision) return { deductible: decision.all };
  return decision.rows[index] ?? null;
}

// Every row has an answer (a per-row decision must cover every row).
export function isExpenseDecisionComplete(decision: ExpenseDecision | null | undefined, rowCount: number): boolean {
  if (!decision) return false;
  if ('all' in decision) return typeof decision.all === 'boolean';
  if (decision.rows.length !== rowCount) return false;
  return decision.rows.every((r) => typeof r?.deductible === 'boolean');
}

// The import card's state -> a decision, or null while any row is still
// unanswered (Save stays disabled). `all` is the "apply to all items"
// answer; `perRow` holds per-item overrides; `categories` holds the
// categories the user changed (only for rows answered Yes).
export type ExpenseChoiceState = {
  all: boolean | null;
  perRow: Record<number, boolean>;
  categories: Record<number, string>;
};

export function emptyExpenseChoice(): ExpenseChoiceState {
  return { all: null, perRow: {}, categories: {} };
}

export function effectiveDeductible(state: ExpenseChoiceState, index: number): boolean | null {
  const own = state.perRow[index];
  return typeof own === 'boolean' ? own : state.all;
}

export function buildExpenseDecision(state: ExpenseChoiceState, rowCount: number): ExpenseDecision | null {
  if (rowCount <= 0) return null;
  const rows: ExpenseDecisionRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const deductible = effectiveDeductible(state, i);
    if (deductible === null) return null;
    const category = deductible ? state.categories[i] ?? null : null;
    rows.push(category ? { deductible, category } : { deductible });
  }
  return { rows };
}

// Rows the decision will actually write (for the "nothing was recorded"
// confirmation and the per-row preview).
export function deductibleRowCount(decision: ExpenseDecision, rowCount: number): number {
  let n = 0;
  for (let i = 0; i < rowCount; i++) if (resolveExpenseRow(decision, i)?.deductible) n++;
  return n;
}
