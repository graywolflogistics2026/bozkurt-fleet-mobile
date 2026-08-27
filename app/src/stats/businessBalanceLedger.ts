// BUSINESS BALANCE LEDGER RECONCILIATION (owner decision, device report:
// business_balance grew by an unexplained ~$5,741 on top of an already-
// known-wrong figure). `profiles.business_balance` starts at 0 and is
// ONLY ever moved by two atomic mechanisms — a settlement's own
// `business_balance_credit` (applied on save/re-import via
// apply_settlement_business_balance_credit(), reversed automatically on
// delete via the AAFTER DELETE trigger, docs/PENDING_SQL.md §70) and a
// manual capital_transactions row's own `business_balance_applied`
// (record/update/delete_manual_capital_transaction(), §60 — a LINKED
// contribution's own business_balance_applied is always 0, since paying a
// business expense personally never itself deposits real cash into
// checking). That means the CURRENT balance should always exactly equal
// the sum of every currently-existing settlement's own credit plus every
// currently-existing capital_transactions row's own applied delta — this
// is what makes the ledger independently RECONSTRUCTABLE and VERIFIABLE
// entirely from data the app already has, without needing direct database
// access to explain a drift.
export type LedgerSettlementRow = { id: string; week_ending?: string | null; business_balance_credit: number | null };
export type LedgerCapitalTransactionRow = {
  id: string;
  tx_type: 'contribution' | 'draw';
  business_balance_applied: number | null;
  tx_date?: string;
  note?: string | null;
};

export type BusinessBalanceReconciliation = {
  storedBalance: number;
  expectedBalance: number;
  // storedBalance - expectedBalance — nonzero means SOMETHING moved the
  // balance outside these two tracked mechanisms (or double-applied one
  // of them), and is the actual number to chase down.
  drift: number;
  settlementsTotal: number;
  manualTransactionsTotal: number;
  settlementCount: number;
  manualTransactionCount: number;
  matches: boolean;
};

const CENTS = 100;
function round2(n: number): number {
  return Math.round(n * CENTS) / CENTS;
}

export function reconcileBusinessBalance(
  settlements: LedgerSettlementRow[],
  capitalTransactions: LedgerCapitalTransactionRow[],
  storedBalance: number
): BusinessBalanceReconciliation {
  const settlementsTotal = round2(settlements.reduce((sum, s) => sum + Number(s.business_balance_credit ?? 0), 0));
  const manualTransactionsTotal = round2(
    capitalTransactions.reduce((sum, tx) => sum + Number(tx.business_balance_applied ?? 0), 0)
  );
  const expectedBalance = round2(settlementsTotal + manualTransactionsTotal);
  const drift = round2(storedBalance - expectedBalance);
  return {
    storedBalance: round2(storedBalance),
    expectedBalance,
    drift,
    settlementsTotal,
    manualTransactionsTotal,
    settlementCount: settlements.filter((s) => Number(s.business_balance_credit ?? 0) !== 0).length,
    manualTransactionCount: capitalTransactions.filter((tx) => Number(tx.business_balance_applied ?? 0) !== 0).length,
    matches: drift === 0,
  };
}
