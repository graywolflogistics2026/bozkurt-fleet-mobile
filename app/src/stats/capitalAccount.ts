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
