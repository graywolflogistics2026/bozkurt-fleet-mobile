import { isNegativeTransactionRow } from '@/src/stats/transactionDisplay';

// Reproduces the exact reported bug: a negative-net settlement ("you owe
// the carrier") must render as negative regardless of its row `type`.
// Fixture numbers match this codebase's own established NEGATIVE
// SETTLEMENTS test data (aiImportSave.negativeSettlement.test.ts): gross
// $5.16, net -$1,155.35.
describe('isNegativeTransactionRow (owner decision, device report)', () => {
  it('THE BUG: a negative-net settlement is a negative row, not a positive one', () => {
    expect(isNegativeTransactionRow({ type: 'income', amount: -1155.35 })).toBe(true);
  });

  it('a normal positive-net settlement is a positive row', () => {
    expect(isNegativeTransactionRow({ type: 'income', amount: 850 })).toBe(false);
  });

  it('a zero-net settlement (a real "home week," never negative) is a positive row', () => {
    expect(isNegativeTransactionRow({ type: 'income', amount: 0 })).toBe(false);
  });

  it('an expense row is always negative regardless of its (always-positive) amount', () => {
    expect(isNegativeTransactionRow({ type: 'expense', amount: 550 })).toBe(true);
    expect(isNegativeTransactionRow({ type: 'expense', amount: 0 })).toBe(true);
  });
});
