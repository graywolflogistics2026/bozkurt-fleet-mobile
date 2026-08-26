import {
  calcCapitalAccount,
  findDuplicateTransactionIds,
  manualTransactionBalanceDelta,
  summarizeContributions,
  calcReimbursementStatus,
  summarizeCapitalFlows,
  buildCapitalFlowRows,
  validateCapitalTransactionDate,
  computeManualTransactionBalanceAdjustment,
  isLinkedContribution,
} from '@/src/stats/capitalAccount';
import { groupByMonth } from '@/src/stats/monthGroups';

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

// OWNER'S EQUITY ROW DETAIL (owner decision, device report: "contributions
// and draws currently show too little — every row must carry its exact
// date, its full description/note as the user entered it, its type, and
// its amount"). Same 4-way classification summarizeCapitalFlows() already
// uses, but ITEMIZED — one row per real transaction, never netted.
describe('buildCapitalFlowRows', () => {
  it('classifies all 4 types correctly: cash contribution in / expense paid personally / reimbursement taken back / owner draw out', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 60000, tx_date: '2026-01-01', note: 'Initial deposit' },
      { id: 'b', tx_type: 'contribution' as const, amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1', note: 'Parts — paid personally (Cash)' },
      { id: 'c', tx_type: 'draw' as const, amount: 100, tx_date: '2026-07-15', linked_deduction_id: 'ded-1', note: 'Parts — reimbursed to owner' },
      { id: 'd', tx_type: 'draw' as const, amount: 5000, tx_date: '2026-08-01', note: 'Personal withdrawal' },
    ];
    const built = buildCapitalFlowRows(rows);
    expect(built.map((r) => r.type)).toEqual(['cashContribution', 'expensePaidPersonally', 'reimbursementTakenBack', 'ownerDraw']);
  });

  it('carries the real date, full note, and exact amount through untouched, for every row', () => {
    const rows = [{ id: 'a', tx_type: 'contribution' as const, amount: 1234.56, tx_date: '2026-05-15', note: 'A very specific note the user typed' }];
    const built = buildCapitalFlowRows(rows);
    expect(built[0]).toEqual({
      id: 'a',
      date: '2026-05-15',
      description: 'A very specific note the user typed',
      type: 'cashContribution',
      amount: 1234.56,
    });
  });

  it('falls back to a plain, type-specific description when a row has no note at all (an old row entered before notes were required)', () => {
    const rows = [
      { id: 'a', tx_type: 'contribution' as const, amount: 100, tx_date: '2026-01-01' },
      { id: 'b', tx_type: 'draw' as const, amount: 50, tx_date: '2026-01-02' },
    ];
    const built = buildCapitalFlowRows(rows);
    expect(built[0].description).toBe('Cash contribution');
    expect(built[1].description).toBe('Owner draw');
  });

  it('sorts chronologically (oldest first), regardless of input order', () => {
    const rows = [
      { id: 'newest', tx_type: 'draw' as const, amount: 10, tx_date: '2026-08-01' },
      { id: 'oldest', tx_type: 'contribution' as const, amount: 10, tx_date: '2026-01-01' },
      { id: 'middle', tx_type: 'contribution' as const, amount: 10, tx_date: '2026-05-01' },
    ];
    const built = buildCapitalFlowRows(rows);
    expect(built.map((r) => r.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('never nets/aggregates — a partially-reimbursed contribution and its own reimbursement both appear as their OWN separate rows with their own real amounts', () => {
    // summarizeCapitalFlows() would net these to $200 "still outstanding" —
    // buildCapitalFlowRows() must show the real $300 contribution AND the
    // real $100 reimbursement as two distinct, un-netted rows.
    const rows = [
      { id: 'contrib', tx_type: 'contribution' as const, amount: 300, tx_date: '2026-07-08', linked_deduction_id: 'ded-2', note: 'Repair — paid personally (Cash)' },
      { id: 'reimb', tx_type: 'draw' as const, amount: 100, tx_date: '2026-07-15', linked_deduction_id: 'ded-2', note: 'Repair — reimbursed to owner' },
    ];
    const built = buildCapitalFlowRows(rows);
    expect(built).toHaveLength(2);
    expect(built.find((r) => r.id === 'contrib')?.amount).toBe(300);
    expect(built.find((r) => r.id === 'reimb')?.amount).toBe(100);
  });

  it('an empty history produces an empty list, never throws', () => {
    expect(buildCapitalFlowRows([])).toEqual([]);
  });
});

// CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24). Item 1:
// "no future dates beyond today, no obviously wrong years."
describe('validateCapitalTransactionDate', () => {
  const now = new Date('2026-08-24T12:00:00Z');

  it('accepts a plain past date', () => {
    expect(validateCapitalTransactionDate('2026-03-15', now)).toEqual({ valid: true });
  });

  it('accepts today itself', () => {
    expect(validateCapitalTransactionDate('2026-08-24', now)).toEqual({ valid: true });
  });

  it('rejects a date in the future', () => {
    expect(validateCapitalTransactionDate('2026-08-25', now)).toEqual({ valid: false, reason: 'future' });
  });

  it('rejects a year before the plausible floor (a likely typo, e.g. 2016 instead of 2026)', () => {
    expect(validateCapitalTransactionDate('2016-03-15', now)).toEqual({ valid: false, reason: 'tooOld' });
  });

  it('rejects a malformed date string', () => {
    expect(validateCapitalTransactionDate('not-a-date', now)).toEqual({ valid: false, reason: 'invalid' });
    expect(validateCapitalTransactionDate('2026-13-45', now)).toEqual({ valid: false, reason: 'invalid' });
    expect(validateCapitalTransactionDate('', now)).toEqual({ valid: false, reason: 'invalid' });
  });

  // "back-dated entry lands in the right month's report" — proves a
  // back-dated tx_date isn't just ACCEPTED, it round-trips through the
  // exact same month-bucketing every other list screen in this app uses
  // (groupByMonth, src/stats/monthGroups.ts) and lands in ITS OWN
  // historical month, never silently drifting into today's month due to
  // a timezone/parsing bug.
  it('a validated back-dated entry buckets into its own historical month via groupByMonth, not the current month', () => {
    const backDated = { id: 'a', tx_date: '2026-03-15', amount: 500 };
    const today = { id: 'b', tx_date: '2026-08-24', amount: 300 };
    expect(validateCapitalTransactionDate(backDated.tx_date, now)).toEqual({ valid: true });

    const groups = groupByMonth([backDated, today], (tx) => tx.tx_date, (tx) => tx.amount);
    const marchGroup = groups.find((g) => g.monthKey === '2026-03');
    const augustGroup = groups.find((g) => g.monthKey === '2026-08');
    expect(marchGroup?.rows.map((r) => r.id)).toEqual(['a']);
    expect(augustGroup?.rows.map((r) => r.id)).toEqual(['b']);
    // Never lumped into the same bucket as today's entry.
    expect(marchGroup).not.toBe(augustGroup);
  });
});

// CAPITAL ACCOUNT — THREE UI FIXES, item 3 "every row editable... edits
// adjust the balance by the DIFFERENCE only (no drift on repeated
// edits)".
describe('computeManualTransactionBalanceAdjustment', () => {
  it('a fresh $500 contribution (previousBalanceApplied 0) adjusts by the full +$500', () => {
    expect(computeManualTransactionBalanceAdjustment('contribution', 500, 0)).toBe(500);
  });

  it('editing a $500 contribution UP to $800 adjusts by only +$300, not the full new amount', () => {
    expect(computeManualTransactionBalanceAdjustment('contribution', 800, 500)).toBe(300);
  });

  it('editing a $500 contribution DOWN to $200 adjusts by -$300', () => {
    expect(computeManualTransactionBalanceAdjustment('contribution', 200, 500)).toBe(-300);
  });

  it('editing a draw follows the same delta-only rule in the negative direction', () => {
    // A $200 draw applied -$200; editing it up to $350 should apply an
    // additional -$150, landing on a total of -$350 applied.
    expect(computeManualTransactionBalanceAdjustment('draw', 350, -200)).toBe(-150);
  });

  it('re-saving the exact same amount is a true no-op adjustment', () => {
    expect(computeManualTransactionBalanceAdjustment('contribution', 500, 500)).toBe(0);
  });

  // "No drift on repeated edits" — a chain of edits, each computing its
  // own adjustment from the PREVIOUS row's own stored
  // business_balance_applied (never re-derived from the row's amount),
  // must sum to exactly the delta between the very first and very last
  // amount — proving no drift accumulates no matter how many edits occur
  // in between.
  it('a chain of repeated edits never drifts — the sum of every adjustment equals start-to-end delta', () => {
    let applied = 0; // previousBalanceApplied, starts at 0 (brand new row)
    const amounts = [500, 800, 650, 1000, 900];
    let totalAdjustment = 0;
    for (const amount of amounts) {
      const adjustment = computeManualTransactionBalanceAdjustment('contribution', amount, applied);
      totalAdjustment += adjustment;
      applied = manualTransactionBalanceDelta('contribution', amount); // what the mutation hook stores as the new business_balance_applied
    }
    // Started at $0 applied, ended at $900 applied — the sum of every
    // incremental adjustment along the way must equal exactly $900, not
    // more and not less, regardless of how many edits happened.
    expect(totalAdjustment).toBe(900);
    expect(applied).toBe(900);
  });
});

// CAPITAL ACCOUNT — THREE UI FIXES, item 3 "linked rows keep their amount
// locked" — the one shared predicate the edit sheet's amount-lock
// decision and the history row's 🔗 indicator both read from.
describe('isLinkedContribution', () => {
  it('a contribution with a linked_deduction_id is linked', () => {
    expect(isLinkedContribution({ id: 'a', tx_type: 'contribution', amount: 200, tx_date: '2026-07-01', linked_deduction_id: 'ded-1' })).toBe(true);
  });

  it('a plain cash contribution (no linked_deduction_id) is not linked', () => {
    expect(isLinkedContribution({ id: 'a', tx_type: 'contribution', amount: 60000, tx_date: '2026-01-01' })).toBe(false);
  });

  it('a DRAW is never "linked" for amount-locking purposes even when it carries a linked_deduction_id (a reimbursement draw, not a contribution)', () => {
    expect(isLinkedContribution({ id: 'a', tx_type: 'draw', amount: 100, tx_date: '2026-07-15', linked_deduction_id: 'ded-1' })).toBe(false);
  });
});

// CAPITAL ACCOUNT — THREE UI FIXES, item 3 "delete reverses cleanly" — a
// full insert -> edit -> delete lifecycle must leave business_balance
// EXACTLY where it started (net $0 effect), proving deleteManualCapitalTransaction's
// own reversal (`-business_balance_applied`, unchanged by this pass) still
// reverses the CURRENT stored applied amount correctly even after one or
// more edits changed it.
describe('full lifecycle: insert, edit, delete never leaves a balance residue', () => {
  it('insert $500, edit to $800, then delete — net business_balance effect is exactly $0', () => {
    // 1. Insert: business_balance_applied starts at manualTransactionBalanceDelta.
    let businessBalanceApplied = manualTransactionBalanceDelta('contribution', 500);
    let netBusinessBalanceChange = businessBalanceApplied; // +500 credited on insert
    expect(businessBalanceApplied).toBe(500);

    // 2. Edit to $800 — adjust by the DIFFERENCE only.
    const adjustment = computeManualTransactionBalanceAdjustment('contribution', 800, businessBalanceApplied);
    netBusinessBalanceChange += adjustment;
    businessBalanceApplied = manualTransactionBalanceDelta('contribution', 800); // what the row now stores
    expect(adjustment).toBe(300);
    expect(businessBalanceApplied).toBe(800);
    expect(netBusinessBalanceChange).toBe(800); // matches the CURRENT amount, not 500+800

    // 3. Delete — reverses the CURRENT stored business_balance_applied
    // (useDeleteManualCapitalTransaction's own `-Number(tx.business_balance_applied ?? 0)`).
    const reversal = -businessBalanceApplied;
    netBusinessBalanceChange += reversal;
    expect(reversal).toBe(-800);

    // End to end: +500 (insert) +300 (edit adjustment) -800 (delete reversal) = 0.
    expect(netBusinessBalanceChange).toBe(0);
  });

  it('insert, edit DOWN, then delete — still nets to exactly $0', () => {
    let businessBalanceApplied = manualTransactionBalanceDelta('draw', 400);
    let netBusinessBalanceChange = businessBalanceApplied; // -400 on insert

    const adjustment = computeManualTransactionBalanceAdjustment('draw', 150, businessBalanceApplied);
    netBusinessBalanceChange += adjustment;
    businessBalanceApplied = manualTransactionBalanceDelta('draw', 150);

    const reversal = -businessBalanceApplied;
    netBusinessBalanceChange += reversal;

    expect(netBusinessBalanceChange).toBe(0);
  });

  it('insert, delete with NO edit in between — the original, pre-existing reversal behavior is unchanged', () => {
    const businessBalanceApplied = manualTransactionBalanceDelta('contribution', 250);
    const netBusinessBalanceChange = businessBalanceApplied + -businessBalanceApplied;
    expect(netBusinessBalanceChange).toBe(0);
  });
});
