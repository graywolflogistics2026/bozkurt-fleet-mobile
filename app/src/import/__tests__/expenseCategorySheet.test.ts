import { applySheetPick, sheetAfterAnswer } from '@/src/import/expenseCategorySheet';
import { buildExpenseDecision, emptyExpenseChoice } from '@/src/import/expenseDecision';

describe('import Yes card: when the category pop-up opens', () => {
  test('Yes on a single-item document opens it for that item', () => {
    expect(sheetAfterAnswer(1, { scope: 'all' }, true)).toBe(0);
  });
  test('Yes to all on several items opens nothing', () => {
    expect(sheetAfterAnswer(3, { scope: 'all' }, true)).toBeNull();
  });
  test('Yes on one item of several opens it for that item', () => {
    expect(sheetAfterAnswer(3, { scope: 'row', index: 2 }, true)).toBe(2);
  });
  test('No never opens it', () => {
    expect(sheetAfterAnswer(1, { scope: 'all' }, false)).toBeNull();
    expect(sheetAfterAnswer(3, { scope: 'row', index: 1 }, false)).toBeNull();
  });
});

describe('import Yes card: closing the pop-up', () => {
  test('closing without a tap keeps the current category and the answer (Yes is not blocked)', () => {
    const answered = { ...emptyExpenseChoice(), all: true };
    const after = applySheetPick(answered, 0, null);
    expect(after).toBe(answered);
    expect(buildExpenseDecision(after, 1)).toEqual({ rows: [{ deductible: true }] });
  });
  test('closing keeps an earlier pick', () => {
    const picked = applySheetPick({ ...emptyExpenseChoice(), all: true }, 0, 'Tools & Equipment');
    expect(applySheetPick(picked, 0, null)).toBe(picked);
    expect(buildExpenseDecision(picked, 1)).toEqual({ rows: [{ deductible: true, category: 'Tools & Equipment' }] });
  });
});
