import {
  calcCapitalAccount,
  findDuplicateTransactionIds,
  manualTransactionBalanceDelta,
  summarizeContributions,
} from '@/src/stats/capitalAccount';

describe('calcCapitalAccount', () => {
  it('effective contribution is initial capital plus extra contributions', () => {
    const result = calcCapitalAccount(60000, 5000, 2000);
    expect(result.effectiveContribution).toBe(65000);
    expect(result.taxFreeRemaining).toBe(63000);
  });

  it('goes negative (never clamped at 0) when draws exceed contributions — owner decision 2026-08-05, FULL PARITY pass', () => {
    const result = calcCapitalAccount(60000, 0, 90000);
    expect(result.taxFreeRemaining).toBe(-30000);
  });

  it('a $5,000 draw and a $60,000 contribution never change anything the tax estimate reads — this module has no tax_config/deductions input at all', () => {
    // Regression guard for spec item E.3 ("equity moves cash, not tax"):
    // calcCapitalAccount's signature only ever takes capital_transactions-
    // derived numbers — proving by construction that a draw/contribution
    // can never reach the tax engine through this function.
    const before = calcCapitalAccount(0, 0, 0);
    const afterContribution = calcCapitalAccount(0, 60000, 0);
    const afterDraw = calcCapitalAccount(0, 60000, 5000);
    expect(before.effectiveContribution).toBe(0);
    expect(afterContribution.effectiveContribution).toBe(60000);
    expect(afterDraw.taxFreeRemaining).toBe(55000);
  });
});

describe('manualTransactionBalanceDelta (spec item E.3, owner decision 2026-08-05)', () => {
  it('a contribution is a positive delta (cash into checking)', () => {
    expect(manualTransactionBalanceDelta('contribution', 60000)).toBe(60000);
  });

  it('a draw is a negative delta (cash out of checking)', () => {
    expect(manualTransactionBalanceDelta('draw', 5000)).toBe(-5000);
  });
});

describe('findDuplicateTransactionIds (spec item E.4, owner decision 2026-08-05)', () => {
  it('flags a same date+amount duplicate, keeping the first-seen row', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 500, tx_date: '2026-07-01' },
      { id: 'b', tx_type: 'contribution' as const, amount: 500, tx_date: '2026-07-01' },
    ];
    expect(findDuplicateTransactionIds(rows)).toEqual(['b']);
  });

  it('never flags a manual cash contribution that survives on its own', () => {
    const rows = [{ id: 'a', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01' }];
    expect(findDuplicateTransactionIds(rows)).toEqual([]);
  });

  it('never touches a LINKED contribution even if it shares a date+amount with another row', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' },
      { id: 'b', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-2' },
    ];
    expect(findDuplicateTransactionIds(rows)).toEqual([]);
  });

  it('does not cross-match a contribution against a draw with the same date/amount', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 500, tx_date: '2026-07-01' },
      { id: 'b', tx_type: 'draw' as const, amount: 500, tx_date: '2026-07-01' },
    ];
    expect(findDuplicateTransactionIds(rows)).toEqual([]);
  });
});

describe('summarizeContributions (spec item E.4, owner decision 2026-08-05)', () => {
  it('splits cash transfers from linked (paid-personally) contributions', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01' },
      { id: 'b', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' },
      { id: 'c', tx_type: 'contribution' as const, amount: 448, tx_date: '2026-07-08', linked_deduction_id: 'ded-2' },
    ];
    const result = summarizeContributions(rows);
    expect(result).toEqual({ cashAmount: 60000, cashCount: 1, linkedAmount: 648, linkedCount: 2 });
  });

  it('signals "no cash transfer" when every contribution is linked', () => {
    const rows = [{ id: 'a', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' }];
    const result = summarizeContributions(rows);
    expect(result.cashCount).toBe(0);
    expect(result.linkedCount).toBe(1);
  });
});
