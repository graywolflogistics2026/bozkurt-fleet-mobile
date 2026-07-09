import { supabase } from '@/src/lib/supabase';
import type { ContributionSyncPlan } from '@/src/stats/contributionSync';

// Looks up the single capital_transactions contribution row id-linked to
// this deduction, if any (CLAUDE.md invariant #2 — id-linked, never
// duplicated).
export async function fetchLinkedContributionId(userId: string, deductionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('capital_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('tx_type', 'contribution')
    .eq('linked_deduction_id', deductionId)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

// Applies a plan computed by planContributionSync() (app/src/stats/contributionSync.ts).
export async function applyContributionSync(
  userId: string,
  deductionId: string,
  plan: ContributionSyncPlan
): Promise<void> {
  if (plan.action === 'noop') return;

  if (plan.action === 'remove') {
    const { error } = await supabase.from('capital_transactions').delete().eq('id', plan.id);
    if (error) throw error;
    return;
  }

  if (plan.action === 'update') {
    const { error } = await supabase
      .from('capital_transactions')
      .update({ amount: plan.amount, note: plan.note, tx_date: plan.date })
      .eq('id', plan.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('capital_transactions').insert({
    user_id: userId,
    tx_type: 'contribution',
    amount: plan.amount,
    tx_date: plan.date,
    note: plan.note,
    linked_deduction_id: deductionId,
  });
  if (error) throw error;
}

// Legacy cleanupStaleDocs() (legacy/index.html:1076-1090) removes document
// records that no longer match any real data so a re-import of the same
// receipt doesn't false-flag as a duplicate (PROMPTS.md Session 7). Our
// schema has explicit document_id FKs instead of legacy's date-matching
// heuristic, so this is a targeted check: a single receipt can back
// multiple deduction rows (qty/tax-fold lines all share one document_id —
// app/src/import/mapExtraction.ts mapPurchase()), so only delete the
// documents row once NOTHING still references it.
export async function cleanupOrphanedDocument(documentId: string): Promise<void> {
  const [dedResult, settResult, maintResult] = await Promise.all([
    supabase.from('deductions').select('id', { count: 'exact', head: true }).eq('document_id', documentId),
    supabase.from('settlements').select('id', { count: 'exact', head: true }).eq('document_id', documentId),
    supabase.from('maintenance_records').select('id', { count: 'exact', head: true }).eq('document_id', documentId),
  ]);
  if (dedResult.error) throw dedResult.error;
  if (settResult.error) throw settResult.error;
  if (maintResult.error) throw maintResult.error;

  const stillReferenced = (dedResult.count ?? 0) > 0 || (settResult.count ?? 0) > 0 || (maintResult.count ?? 0) > 0;
  if (stillReferenced) return;

  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw error;
}
