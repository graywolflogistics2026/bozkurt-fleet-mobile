import { supabase } from '@/src/lib/supabase';
import type { ContributionSyncPlan } from '@/src/stats/contributionSync';
import type { Deduction } from '@/src/types/db';

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

// DEDUCTION EDIT + CONTRIBUTION SYNC NOT ATOMIC (P1 fix, FULL SYSTEM
// AUDIT, docs/PENDING_SQL.md §62) — updateDeduction.mutateAsync() followed
// by a SEPARATE applyContributionSync() call was two independent network
// round trips with no atomicity between them; a network drop in between
// left the deduction saved with a stale/missing/orphaned linked
// contribution, corrupting taxFreeRemaining. These two functions fold the
// deduction write and its contribution sync into ONE atomic RPC — either
// both happen or neither does. `applyContributionSync()`/
// `fetchLinkedContributionId()` above are UNCHANGED and still used by
// call sites that don't go through this atomic path (accountant-package.tsx's
// category-only edit, documents.tsx's payment-method quick-edit — neither
// currently re-syncs the contribution at all, a separate, narrower,
// pre-existing gap flagged in §62's own writeup rather than folded into
// this fix).
export async function updateDeductionWithContributionSync(params: {
  deductionId: string;
  userId: string;
  category: string;
  paymentMethod: string;
  amount: number;
  taxDeductible: boolean;
  plan: ContributionSyncPlan;
}): Promise<Deduction> {
  const { deductionId, userId, category, paymentMethod, amount, taxDeductible, plan } = params;
  const { data, error } = await supabase.rpc('update_deduction_with_contribution_sync', {
    p_deduction_id: deductionId,
    p_user_id: userId,
    p_category: category,
    p_payment_method: paymentMethod,
    p_amount: amount,
    p_tax_deductible: taxDeductible,
    p_sync_action: plan.action,
    p_contribution_id: plan.action === 'update' || plan.action === 'remove' ? plan.id : null,
    p_contribution_amount: plan.action === 'create' || plan.action === 'update' ? plan.amount : null,
    p_contribution_note: plan.action === 'create' || plan.action === 'update' ? plan.note : null,
    p_contribution_date: plan.action === 'create' || plan.action === 'update' ? plan.date : null,
  });
  if (error) throw error;
  return data as Deduction;
}

export async function insertDeductionWithContributionSync(params: {
  userId: string;
  description: string | null;
  category: string;
  paymentMethod: string;
  amount: number;
  dedDate: string | null;
  taxDeductible: boolean;
  createContribution: boolean;
  contributionNote?: string;
}): Promise<Deduction> {
  const { userId, description, category, paymentMethod, amount, dedDate, taxDeductible, createContribution, contributionNote } = params;
  const { data, error } = await supabase.rpc('insert_deduction_with_contribution_sync', {
    p_user_id: userId,
    p_description: description,
    p_category: category,
    p_payment_method: paymentMethod,
    p_amount: amount,
    p_ded_date: dedDate,
    p_source: 'manual',
    p_tax_deductible: taxDeductible,
    p_create_contribution: createContribution,
    p_contribution_note: contributionNote ?? null,
  });
  if (error) throw error;
  return data as Deduction;
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
