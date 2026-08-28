// TRANSACTIONS SIGN FIX (owner decision, device report: a "you owe the
// carrier" negative-net settlement rendered green/positive on the
// Transactions screen despite Settlements' own screen correctly framing
// it as negative — a real sign-handling bug, isolated to display).
//
// Extracted as a pure function (this repo has no React Native rendering
// harness — see every other `src/stats/*.ts` module for the same
// "pure logic here, thin render read from it" split) so the actual
// sign/color decision is unit-testable, not just visually inspectable.
//
// `type: 'income'` rows are settlements — `amount` is the settlement's
// own `net` (net pay after carrier withholdings), which genuinely CAN be
// negative ("you owe the carrier"); that sign, not the row's `type`,
// must drive whether it's shown as an inflow or an outflow.
//
// `type: 'expense'` rows are deductions — `amount` is always stored as a
// positive dollar magnitude representing a real expense/withholding
// (confirmed against this codebase's own NEGATIVE SETTLEMENTS fixtures,
// e.g. a $550 advance-repayment or $100 escrow line is never itself
// negative; only a SETTLEMENT's own net pay can go negative when total
// deductions exceed gross), so an expense row is unconditionally an
// outflow regardless of its own (always-positive) amount's sign.
export type TransactionDisplayType = 'income' | 'expense';
export type TransactionDisplayRow = { type: TransactionDisplayType; amount: number };

export function isNegativeTransactionRow(row: TransactionDisplayRow): boolean {
  return row.type === 'expense' || row.amount < 0;
}
