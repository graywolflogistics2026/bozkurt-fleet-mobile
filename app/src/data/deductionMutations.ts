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
//
// CASCADE DELETE (owner decision 2026-08-05, FULL PARITY pass item F.1):
// this used to only delete the `documents` DB ROW, leaving the actual
// uploaded file sitting in Storage forever — an orphan the user would
// never see again but that still counted against their storage. Now
// reads the row's `storage_path` FIRST and removes the Storage object
// too, in the same "documents" bucket every upload writes to
// (CLAUDE.md's Storage-path convention). A Storage removal failure does
// NOT block the documents-row delete from completing — the row itself
// (the thing the user actually sees/searches) is the more important
// half to clean up; a stray Storage object with no DB row pointing to it
// is inert and can be swept up later, whereas a DB row with a 404'd
// storage_path is a broken "View Document" link the user would hit
// immediately.
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

  const { data: doc, error: fetchError } = await supabase.from('documents').select('storage_path').eq('id', documentId).maybeSingle();
  if (fetchError) throw fetchError;

  if (doc?.storage_path) {
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.storage_path]);
    if (storageError) console.warn('cleanupOrphanedDocument: failed to remove Storage object', storageError);
  }

  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw error;
}
