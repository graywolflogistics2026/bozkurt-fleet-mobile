export type CapitalAccountSummary = {
  effectiveContribution: number;
  totalDraws: number;
  taxFreeRemaining: number;
};

// Verbatim port of legacy rCapital() (legacy/index.html:1380-1384):
//   const effectiveContribution=CAPITAL.contribution+totalContrib;
//   const capRemain=effectiveContribution-totalDraws;
// FULL PARITY pass (owner decision 2026-08-05, spec item E.5): legacy's
// OWN display clamped capRemain at 0 (Math.max(0,capRemain)) — but a real
// owner CAN draw past their capital (it just means further draws are
// coming out of profit, not tax-free capital), and clamping the actual
// NUMBER at $0 hid that fact from the screen entirely (the UI's own color
// logic already correctly compared the unclamped
// effectiveContribution-totalDraws for red/green, while the displayed
// FIGURE itself silently floored at $0 — a real, user-visible bug, not
// just a legacy quirk to preserve). taxFreeRemaining is now the live,
// unclamped value; a negative result is real and must be shown as such
// (`capitalAccount.pastCapitalWarning` in the UI) rather than papered over.
export function calcCapitalAccount(
  initialCapital: number,
  totalContributions: number,
  totalDraws: number
): CapitalAccountSummary {
  const effectiveContribution = initialCapital + totalContributions;
  return {
    effectiveContribution,
    totalDraws,
    taxFreeRemaining: effectiveContribution - totalDraws,
  };
}

export type CapitalTransactionLike = {
  id: string;
  tx_type: 'contribution' | 'draw';
  amount: number | null;
  tx_date: string;
  linked_deduction_id?: string | null;
};

// FULL PARITY pass (owner decision 2026-08-05, spec item E.4) — "remove
// duplicate entries" action: same date + amount, never touching a LINKED
// contribution (linked_deduction_id set) — a linked row syncs from its
// own deduction (planContributionSync above) and a duplicate scan can
// never reliably distinguish "the same transaction entered twice" from
// "two personally-paid expenses that happen to share a date and amount."
// Keeps the first-seen row per (tx_type, tx_date, amount) group, returns
// the ids of every later duplicate to delete.
export function findDuplicateTransactionIds(transactions: CapitalTransactionLike[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const tx of transactions) {
    if (tx.linked_deduction_id) continue;
    const key = `${tx.tx_type}|${tx.tx_date}|${Number(tx.amount ?? 0).toFixed(2)}`;
    if (seen.has(key)) {
      duplicates.push(tx.id);
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

// FULL PARITY pass (owner decision 2026-08-05, spec item E.3 "equity
// moves cash, not tax") — the signed delta a MANUAL (non-linked)
// draw/contribution applies to profiles.business_balance: +amount for a
// contribution (cash deposited into business checking), -amount for a
// draw (cash withdrawn). Deliberately NOT called for a LINKED
// contribution (auto-synced from a personally-paid deduction) — no real
// cash moved into checking for that event, only equity was built by
// paying a business expense out of pocket; crediting business_balance
// there would fabricate a deposit that never happened.
export function manualTransactionBalanceDelta(txType: 'contribution' | 'draw', amount: number): number {
  return txType === 'contribution' ? amount : -amount;
}

export type ContributionBreakdown = {
  cashAmount: number;
  cashCount: number;
  linkedAmount: number;
  linkedCount: number;
};

// FULL PARITY pass (owner decision 2026-08-05, spec item E.4) — "cash
// transfers $X (n) · paid personally $Y (m)" breakdown line, and the
// signal for "no cash transfer exists" (cashCount === 0 while
// linkedCount > 0 — a business whose owner's equity is entirely built
// from personally-paid expense links, never an actual cash deposit).
export function summarizeContributions(contributions: CapitalTransactionLike[]): ContributionBreakdown {
  let cashAmount = 0;
  let cashCount = 0;
  let linkedAmount = 0;
  let linkedCount = 0;
  for (const c of contributions) {
    const amount = Number(c.amount ?? 0);
    if (c.linked_deduction_id) {
      linkedAmount += amount;
      linkedCount += 1;
    } else {
      cashAmount += amount;
      cashCount += 1;
    }
  }
  return { cashAmount, cashCount, linkedAmount, linkedCount };
}

// PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 2). "Reimburse Myself" on an owner-paid row reuses
// the EXISTING capital_transactions.linked_deduction_id column, now
// dual-purpose: on a `tx_type:'contribution'` row it means "this
// contribution was auto-synced from this deduction" (unchanged, existing
// behavior); on a `tx_type:'draw'` row it means "this draw reimburses that
// deduction's own contribution" — no new SQL column needed, since
// `(tx_type, linked_deduction_id)` together are already unambiguous. No DB
// CHECK constraint restricts which tx_type may carry this column.
export type ReimbursementStatus = {
  contributionAmount: number;
  reimbursedAmount: number;
  outstandingAmount: number;
  fullyReimbursed: boolean;
};

// "Returned capital must not keep inflating the tax-free base" — the
// outstanding (still-not-reimbursed) portion of a specific personally-paid
// expense's linked contribution, floored at $0 (a reimbursement can never
// exceed what was actually contributed for THAT expense; a caller trying
// to reimburse more than what's outstanding should clamp to this value
// before creating the draw, never overpay from the business).
export function calcReimbursementStatus(
  contributionAmount: number,
  reimbursementDraws: { amount: number | null }[]
): ReimbursementStatus {
  const reimbursedAmount = reimbursementDraws.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const outstandingAmount = Math.max(0, contributionAmount - reimbursedAmount);
  return { contributionAmount, reimbursedAmount, outstandingAmount, fullyReimbursed: outstandingAmount <= 0 };
}

export type CapitalFlowsSummary = {
  // 1. Cash contributed — capital IN, not income.
  cashContributed: number;
  cashContributedCount: number;
  // 2. Expenses paid personally, STILL OUTSTANDING — capital IN. Netted
  // against whatever's already been reimbursed for that specific expense
  // (never the full original amount once part of it has come back).
  expensesPaidPersonallyOutstanding: number;
  expensesPaidPersonallyOutstandingCount: number;
  // 3. Reimbursements taken back — capital OUT, NOT an expense (returning
  // the owner's own already-contributed money, never a new business cost).
  reimbursementsTakenBack: number;
  reimbursementsTakenBackCount: number;
  // 4. Owner draws — capital OUT, not wages (a plain, unlinked draw).
  ownerDraws: number;
  ownerDrawsCount: number;
  // contributions (full, cash + linked) − draws − reimbursements — the
  // SAME number calcCapitalAccount()'s effectiveContribution-totalDraws
  // already produces, computed here from the 4-flow breakdown instead so
  // the Capital Account screen's own flow cards and headline total can
  // never silently disagree.
  netPosition: number;
};

// Reads DIRECTLY off the full capital_transactions list (both
// tx_type:'contribution' and tx_type:'draw' rows) — one pass, no separate
// pre-filtering by the caller required.
export function summarizeCapitalFlows(transactions: CapitalTransactionLike[]): CapitalFlowsSummary {
  let cashContributed = 0;
  let cashContributedCount = 0;
  let ownerDraws = 0;
  let ownerDrawsCount = 0;
  let reimbursementsTakenBack = 0;
  let reimbursementsTakenBackCount = 0;
  const contributionByDeduction = new Map<string, number>();
  const reimbursedByDeduction = new Map<string, number>();

  for (const tx of transactions) {
    const amount = Number(tx.amount ?? 0);
    if (tx.tx_type === 'contribution') {
      if (tx.linked_deduction_id) {
        contributionByDeduction.set(tx.linked_deduction_id, (contributionByDeduction.get(tx.linked_deduction_id) ?? 0) + amount);
      } else {
        cashContributed += amount;
        cashContributedCount += 1;
      }
    } else if (tx.linked_deduction_id) {
      reimbursementsTakenBack += amount;
      reimbursementsTakenBackCount += 1;
      reimbursedByDeduction.set(tx.linked_deduction_id, (reimbursedByDeduction.get(tx.linked_deduction_id) ?? 0) + amount);
    } else {
      ownerDraws += amount;
      ownerDrawsCount += 1;
    }
  }

  let expensesPaidPersonallyOutstanding = 0;
  let expensesPaidPersonallyOutstandingCount = 0;
  let totalLinkedContributions = 0;
  for (const [deductionId, contributionAmount] of contributionByDeduction) {
    totalLinkedContributions += contributionAmount;
    const status = calcReimbursementStatus(contributionAmount, [{ amount: reimbursedByDeduction.get(deductionId) ?? 0 }]);
    if (status.outstandingAmount > 0) {
      expensesPaidPersonallyOutstanding += status.outstandingAmount;
      expensesPaidPersonallyOutstandingCount += 1;
    }
  }

  const netPosition = cashContributed + totalLinkedContributions - ownerDraws - reimbursementsTakenBack;

  return {
    cashContributed,
    cashContributedCount,
    expensesPaidPersonallyOutstanding,
    expensesPaidPersonallyOutstandingCount,
    reimbursementsTakenBack,
    reimbursementsTakenBackCount,
    ownerDraws,
    ownerDrawsCount,
    netPosition,
  };
}
