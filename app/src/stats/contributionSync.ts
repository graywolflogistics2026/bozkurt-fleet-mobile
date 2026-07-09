// Verbatim port of legacy syncContributionForDeduction()
// (legacy/index.html:1025-1033): given a deduction's current
// payment/amount and whatever contribution is already linked to it (if
// any), decides whether the linked contribution should be created,
// updated, or removed — id-linked, add/update/remove, never duplicate
// (CLAUDE.md invariant #2).
//
// The CREATE case is the only one gated behind the 2026-07-07 owner-
// contribution confirmation dialog (a brand-new contribution didn't exist
// before); UPDATE and REMOVE apply unconditionally, same as legacy —
// editing/deleting a deduction that already has a linked contribution
// always keeps it in sync.
export type ContributionSyncPlan =
  | { action: 'create'; amount: number; note: string; date: string }
  | { action: 'update'; id: string; amount: number; note: string; date: string }
  | { action: 'remove'; id: string }
  | { action: 'noop' };

export type PlanContributionSyncParams = {
  isPersonal: boolean;
  amount: number;
  date: string | null;
  description: string | null;
  paymentMethod: string | null;
  existingContributionId: string | null;
};

export function planContributionSync(params: PlanContributionSyncParams): ContributionSyncPlan {
  const { isPersonal, amount, date, description, paymentMethod, existingContributionId } = params;
  const shouldHaveContribution = isPersonal && amount > 0;

  if (shouldHaveContribution) {
    const note = `${(description ?? 'Deduction').split(' — ')[0]} — paid personally (${paymentMethod ?? ''})`;
    const txDate = date ?? new Date().toISOString().slice(0, 10);
    if (existingContributionId) {
      return { action: 'update', id: existingContributionId, amount, note, date: txDate };
    }
    return { action: 'create', amount, note, date: txDate };
  }

  if (existingContributionId) {
    return { action: 'remove', id: existingContributionId };
  }
  return { action: 'noop' };
}
