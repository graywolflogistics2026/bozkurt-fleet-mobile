import type { ExpenseChoiceState } from './expenseDecision';

// CATEGORY POP-UP on the import Yes card (owner 2026-11-24). Pure rules the
// card (src/components/ExpenseDeductibleChoice.tsx) follows; nothing here
// touches saving.

// Which item's category pop-up opens after an answer, or null for none.
//   - Yes on the document when it has exactly one item: that item.
//   - "Yes to all" on several items: none (each keeps its category).
//   - Yes on one item of several: that item.
//   - No: none.
export type ExpenseAnswer = { scope: 'all' } | { scope: 'row'; index: number };
export function sheetAfterAnswer(rowCount: number, answer: ExpenseAnswer, deductible: boolean): number | null {
  if (!deductible || rowCount <= 0) return null;
  if (answer.scope === 'all') return rowCount === 1 ? 0 : null;
  return answer.index >= 0 && answer.index < rowCount ? answer.index : null;
}

// The card state after the pop-up closes: a tapped category is stored for
// that item; closing without a tap (picked = null) changes nothing, so the
// item keeps its current category and Yes is never blocked.
export function applySheetPick(state: ExpenseChoiceState, index: number, picked: string | null): ExpenseChoiceState {
  if (!picked) return state;
  return { ...state, categories: { ...state.categories, [index]: picked } };
}
