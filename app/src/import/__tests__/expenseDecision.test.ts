import {
  buildExpenseDecision,
  deductibleRowCount,
  emptyExpenseChoice,
  expenseDecisionPath,
  expenseRowCount,
  isExpenseDecisionComplete,
} from '@/src/import/expenseDecision';
import type { Extraction } from '@/src/import/types';

const receipt: Extraction = {
  docType: 'store',
  vendor: 'Home Depot',
  purchase: { items: [{ name: 'Drill', qty: 1, price: 100 }, { name: 'Gloves', qty: 1, price: 20 }], total: 120 },
};

describe('expenseDecisionPath (which imports ask Yes/No)', () => {
  test.each([
    ['store', receipt, 'purchase'],
    ['other', { docType: 'other', totalAmount: 5 } as Extraction, 'generic'],
    ['loan', { docType: 'loan', totalAmount: 5 } as Extraction, 'generic'],
    ['insurance', { docType: 'insurance', financialDoc: { kind: 'insurance', amount: 5 } } as Extraction, 'financial'],
    ['settlement', { docType: 'settlement', settlement: {} } as Extraction, null],
    ['fuel', { docType: 'fuel', fuel: {} } as Extraction, null],
    ['maintenance', { docType: 'maintenance', maintenance: {} } as Extraction, null],
    ['toll', { docType: 'toll', totalAmount: 5 } as Extraction, null],
    ['driver_payment', { docType: 'driver_payment' } as Extraction, null],
    ['w2', { docType: 'w2' } as Extraction, null],
    ['medical_card', { docType: 'medical_card' } as Extraction, null],
    ['loan_agreement', { docType: 'loan_agreement' } as Extraction, null],
  ])('%s', (_l, d, path) => {
    expect(expenseDecisionPath(d)).toBe(path);
  });
});

describe('card state -> decision', () => {
  test('empty by default: nothing can be saved', () => {
    expect(buildExpenseDecision(emptyExpenseChoice(), 2)).toBeNull();
    expect(isExpenseDecisionComplete(null, 2)).toBe(false);
  });
  test('apply to all + one per-item override', () => {
    const decision = buildExpenseDecision({ all: true, perRow: { 1: false }, categories: { 0: 'Tools & Equipment', 1: 'Misc' } }, 2);
    expect(decision).toEqual({ rows: [{ deductible: true, category: 'Tools & Equipment' }, { deductible: false }] });
    expect(isExpenseDecisionComplete(decision, 2)).toBe(true);
    expect(deductibleRowCount(decision!, 2)).toBe(1);
  });
  test('per-item answers without an "all" answer must cover every row', () => {
    expect(buildExpenseDecision({ all: null, perRow: { 0: true }, categories: {} }, 2)).toBeNull();
    expect(buildExpenseDecision({ all: null, perRow: { 0: true, 1: true }, categories: {} }, 2)).toEqual({ rows: [{ deductible: true }, { deductible: true }] });
  });
  test('row count follows the purchase mapping', () => {
    expect(expenseRowCount(receipt, 'u')).toBe(2);
    expect(expenseRowCount({ docType: 'toll' }, 'u')).toBe(0);
  });
});
