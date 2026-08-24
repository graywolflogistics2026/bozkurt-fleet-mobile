import {
  calcCapitalAccount,
  findDuplicateTransactionIds,
  manualTransactionBalanceDelta,
  summarizeContributions,
  calcReimbursementStatus,
  summarizeCapitalFlows,
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

// PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
// ADDITIONS pass PART 2)
describe('calcReimbursementStatus', () => {
  it('nothing reimbursed yet — full outstanding', () => {
    expect(calcReimbursementStatus(200, [])).toEqual({
      contributionAmount: 200,
      reimbursedAmount: 0,
      outstandingAmount: 200,
      fullyReimbursed: false,
    });
  });

  it('partially reimbursed — real remaining outstanding, "8/12"-style math', () => {
    const result = calcReimbursementStatus(200, [{ amount: 80 }]);
    expect(result.reimbursedAmount).toBe(80);
    expect(result.outstandingAmount).toBe(120);
    expect(result.fullyReimbursed).toBe(false);
  });

  it('fully reimbursed — 0 outstanding, never negative', () => {
    const result = calcReimbursementStatus(200, [{ amount: 200 }]);
    expect(result.outstandingAmount).toBe(0);
    expect(result.fullyReimbursed).toBe(true);
  });

  it('over-reimbursed (should never happen, but must never go negative)', () => {
    const result = calcReimbursementStatus(200, [{ amount: 150 }, { amount: 100 }]);
    expect(result.reimbursedAmount).toBe(250);
    expect(result.outstandingAmount).toBe(0);
    expect(result.fullyReimbursed).toBe(true);
  });
});

describe('summarizeCapitalFlows', () => {
  it('splits all 4 flows correctly and computes the matching net position', () => {
    const rows = [
      // 1. cash contributed
      { id: 'a', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01' },
      // 2. expense paid personally, still outstanding (no reimbursement yet)
      { id: 'b', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' },
      // a SECOND expense paid personally, PARTIALLY reimbursed
      { id: 'c', tx_type: 'contribution' as const, amount: 300, tx_date: '2026-07-08', linked_deduction_id: 'ded-2' },
      { id: 'd', tx_type: 'draw' as const, amount: 100, tx_date: '2026-07-15', linked_deduction_id: 'ded-2' }, // 3. reimbursement
      // 4. a plain owner draw
      { id: 'e', tx_type: 'draw' as const, amount: 5000, tx_date: '2026-08-01' },
    ];
    const result = summarizeCapitalFlows(rows);
    expect(result.cashContributed).toBe(60000);
    expect(result.cashContributedCount).toBe(1);
    // ded-1's full $200 still outstanding + ded-2's $300-$100=$200 still outstanding = $400
    expect(result.expensesPaidPersonallyOutstanding).toBe(400);
    expect(result.expensesPaidPersonallyOutstandingCount).toBe(2);
    expect(result.reimbursementsTakenBack).toBe(100);
    expect(result.reimbursementsTakenBackCount).toBe(1);
    expect(result.ownerDraws).toBe(5000);
    expect(result.ownerDrawsCount).toBe(1);
    // contributions (60000 + 200 + 300 = 60500) - draws (5000) - reimbursements (100)
    expect(result.netPosition).toBe(55400);
  });

  it('a fully-reimbursed expense drops out of the "still outstanding" bucket entirely', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' },
      { id: 'b', tx_type: 'draw' as const, amount: 200, tx_date: '2026-07-15', linked_deduction_id: 'ded-1' },
    ];
    const result = summarizeCapitalFlows(rows);
    expect(result.expensesPaidPersonallyOutstanding).toBe(0);
    expect(result.expensesPaidPersonallyOutstandingCount).toBe(0);
    expect(result.reimbursementsTakenBack).toBe(200);
  });

  it('empty history — every flow is zero', () => {
    const result = summarizeCapitalFlows([]);
    expect(result).toEqual({
      cashContributed: 0,
      cashContributedCount: 0,
      expensesPaidPersonallyOutstanding: 0,
      expensesPaidPersonallyOutstandingCount: 0,
      reimbursementsTakenBack: 0,
      reimbursementsTakenBackCount: 0,
      ownerDraws: 0,
      ownerDrawsCount: 0,
      netPosition: 0,
    });
  });

  it('agrees with calcCapitalAccount\'s own effectiveContribution-totalDraws for the same data', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01' },
      { id: 'b', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' },
      { id: 'c', tx_type: 'draw' as const, amount: 5000, tx_date: '2026-08-01' },
    ];
    const flows = summarizeCapitalFlows(rows);
    const account = calcCapitalAccount(0, 60000 + 200, 5000);
    expect(flows.netPosition).toBe(account.taxFreeRemaining);
  });
});
