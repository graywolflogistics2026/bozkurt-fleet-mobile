import { reconcileBusinessBalance } from '@/src/stats/businessBalanceLedger';

describe('reconcileBusinessBalance — reconstructs the ledger from data the app already has', () => {
  test('matches when stored balance equals the sum of every settlement credit + every manual transaction delta', () => {
    const settlements = [
      { id: 's1', business_balance_credit: 3200 },
      { id: 's2', business_balance_credit: 2800 },
    ];
    const capitalTransactions = [
      { id: 'c1', tx_type: 'contribution' as const, business_balance_applied: 10000 },
      { id: 'c2', tx_type: 'draw' as const, business_balance_applied: -5000 },
      // A linked contribution never applies anything — 0, same as if it
      // were omitted entirely from the sum.
      { id: 'c3', tx_type: 'contribution' as const, business_balance_applied: 0 },
    ];
    const result = reconcileBusinessBalance(settlements, capitalTransactions, 11000);
    expect(result.settlementsTotal).toBe(6000);
    expect(result.manualTransactionsTotal).toBe(5000);
    expect(result.expectedBalance).toBe(11000);
    expect(result.drift).toBe(0);
    expect(result.matches).toBe(true);
  });

  test('a nonzero drift is surfaced plainly, not hidden — the literal "reconstruct the ledger" request', () => {
    const settlements = [{ id: 's1', business_balance_credit: 4000 }];
    const capitalTransactions = [{ id: 'c1', tx_type: 'contribution' as const, business_balance_applied: 60000 }];
    // Real position per the settlements/transactions on file: 64000.
    // Stored balance reads higher — exactly the reported symptom shape.
    const result = reconcileBusinessBalance(settlements, capitalTransactions, 67638);
    expect(result.expectedBalance).toBe(64000);
    expect(result.storedBalance).toBe(67638);
    expect(result.drift).toBe(3638);
    expect(result.matches).toBe(false);
  });

  test('a negative net-pay (owed-the-carrier) settlement subtracts correctly, not just adds', () => {
    const settlements = [{ id: 's1', business_balance_credit: -1155.35 }];
    const result = reconcileBusinessBalance(settlements, [], -1155.35);
    expect(result.matches).toBe(true);
  });

  test('a deleted settlement (no longer in the list) correctly drops out of the expected total', () => {
    // Simulates: settlement s2 existed, contributed 2800, then was
    // deleted (the AFTER DELETE trigger already reversed it server-side,
    // so business_balance itself is now lower too) — the reconstruction
    // must agree with the NEW, lower balance using only what's left.
    const settlements = [{ id: 's1', business_balance_credit: 3200 }];
    const result = reconcileBusinessBalance(settlements, [], 3200);
    expect(result.matches).toBe(true);
  });

  test('rounds to the cent, never accumulates floating-point drift as a false mismatch', () => {
    const settlements = [
      { id: 's1', business_balance_credit: 0.1 },
      { id: 's2', business_balance_credit: 0.2 },
    ];
    const result = reconcileBusinessBalance(settlements, [], 0.3);
    expect(result.matches).toBe(true);
  });

  test('THREE PERSISTENT ISSUES item 3 — zero settlements, $60k contribution, $5k draw reconstructs to exactly $55,000', () => {
    const capitalTransactions = [
      { id: 'c1', tx_type: 'contribution' as const, business_balance_applied: 60000 },
      { id: 'c2', tx_type: 'draw' as const, business_balance_applied: -5000 },
    ];
    const result = reconcileBusinessBalance([], capitalTransactions, 55000);
    expect(result.settlementsTotal).toBe(0);
    expect(result.manualTransactionsTotal).toBe(55000);
    expect(result.expectedBalance).toBe(55000);
    expect(result.matches).toBe(true);
  });

  test('THREE PERSISTENT ISSUES item 3 — the SAME data against the reported stored value of $61,897 surfaces the exact drift', () => {
    const capitalTransactions = [
      { id: 'c1', tx_type: 'contribution' as const, business_balance_applied: 60000 },
      { id: 'c2', tx_type: 'draw' as const, business_balance_applied: -5000 },
    ];
    const result = reconcileBusinessBalance([], capitalTransactions, 61897);
    expect(result.expectedBalance).toBe(55000);
    expect(result.storedBalance).toBe(61897);
    expect(result.drift).toBe(6897);
    expect(result.matches).toBe(false);
    // Zero settlements means settlementsTotal can never explain any part
    // of this drift — the entire gap is unattributable to anything
    // currently on file, exactly the diagnostic signal that distinguishes
    // "inherited drift from something now deleted" from a live bug.
    expect(result.settlementCount).toBe(0);
    expect(result.settlementsTotal).toBe(0);
  });

  test('counts only nonzero rows for the display counts (a linked contribution never counts)', () => {
    const settlements = [{ id: 's1', business_balance_credit: 0 }];
    const capitalTransactions = [{ id: 'c1', tx_type: 'contribution' as const, business_balance_applied: 0 }];
    const result = reconcileBusinessBalance(settlements, capitalTransactions, 0);
    expect(result.settlementCount).toBe(0);
    expect(result.manualTransactionCount).toBe(0);
    expect(result.matches).toBe(true);
  });
});
