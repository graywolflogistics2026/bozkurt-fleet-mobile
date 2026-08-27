import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';

// ORPHAN CLEANUP TOOL (owner decision, docs/PENDING_SQL.md §70, item 7) —
// a one-time, user-reviewable sweep for records whose parent settlement
// was deleted BEFORE this pass's own fixes existed (a pre-§61
// maintenance_records/tolls row with settlement_id permanently null — no
// way to backfill which settlement it came from, since that link was
// never recorded before the column existed at all; a documents row from
// any older bug/gap in per-record document cleanup). This tool does NOT
// find anything a settlement delete produces GOING FORWARD — that's
// already fixed at the source (settlements.tsx's own delete handler +
// the reverse_settlement_business_balance_credit() trigger) — this is
// specifically for cleaning up the historical backlog.
//
// LOANS ARE DELIBERATELY INFORMATIONAL-ONLY, NEVER OFFERED FOR DELETION
// HERE — a loan is a real, standing financial obligation that legitimately
// outlives any one settlement (docs/PENDING_SQL.md §70's own reasoning);
// listing "loans your settlements once touched" is about VISIBILITY
// (so a settlement-derived loan is never mistaken for a manual leftover),
// never a suggestion to delete real debt data. Deleting a loan, if the
// user decides one is genuinely stale, is a Loan Center action, not this
// tool's.

export type OrphanToll = { id: string; amount: number | null; toll_date: string | null; plaza: string | null };
export type OrphanMaintenanceRecord = { id: string; cost: number | null; service_date: string | null; description: string | null };
export type OrphanDocument = { id: string; filename: string | null; doc_type: string | null; imported_at: string; storage_path: string | null };
export type SettlementSourcedLoan = { id: string; name: string | null; balance: number | null; settlement_id: string | null };

export type OrphanSummary = {
  tolls: OrphanToll[];
  maintenanceRecords: OrphanMaintenanceRecord[];
  documents: OrphanDocument[];
  settlementSourcedLoans: SettlementSourcedLoan[];
};

async function fetchOrphanSummary(userId: string): Promise<OrphanSummary> {
  const [tollsRes, maintRes, documentsRes, settlementsRes, dedRes, loansRes] = await Promise.all([
    // A toll/maintenance row extracted from a settlement's own recap
    // section (source='settlement') that has no settlement_id at all —
    // structurally impossible to have come from anywhere else once
    // settlement_id existed (docs/PENDING_SQL.md §61), so a genuinely
    // orphaned pre-§61 row, never a false positive from a standalone
    // manual/import entry (those are source='manual'/'import').
    supabase.from('tolls').select('id, amount, toll_date, plaza').eq('user_id', userId).eq('source', 'settlement').is('settlement_id', null),
    supabase
      .from('maintenance_records')
      .select('id, cost, service_date, description')
      .eq('user_id', userId)
      .eq('source', 'settlement')
      .is('settlement_id', null),
    supabase.from('documents').select('id, filename, doc_type, imported_at, storage_path').eq('user_id', userId),
    supabase.from('settlements').select('document_id').eq('user_id', userId).not('document_id', 'is', null),
    supabase.from('deductions').select('document_id').eq('user_id', userId).not('document_id', 'is', null),
    supabase.from('loans').select('id, name, balance, settlement_id').eq('user_id', userId).eq('source', 'settlement'),
  ]);
  if (tollsRes.error) throw tollsRes.error;
  if (maintRes.error) throw maintRes.error;
  if (documentsRes.error) throw documentsRes.error;
  if (settlementsRes.error) throw settlementsRes.error;
  if (dedRes.error) throw dedRes.error;
  if (loansRes.error) throw loansRes.error;

  // A document is orphaned once NOTHING references it via document_id —
  // same 3-table check cleanupOrphanedDocument() itself uses (settlements/
  // deductions/maintenance_records), computed here as one set difference
  // instead of a per-row round trip.
  const maintRefsRes = await supabase.from('maintenance_records').select('document_id').eq('user_id', userId).not('document_id', 'is', null);
  if (maintRefsRes.error) throw maintRefsRes.error;
  const referencedDocIds = new Set<string>([
    ...(settlementsRes.data ?? []).map((r) => r.document_id as string),
    ...(dedRes.data ?? []).map((r) => r.document_id as string),
    ...(maintRefsRes.data ?? []).map((r) => r.document_id as string),
  ]);
  const documents = (documentsRes.data ?? []).filter((d) => !referencedDocIds.has(d.id));

  return {
    tolls: (tollsRes.data ?? []) as OrphanToll[],
    maintenanceRecords: (maintRes.data ?? []) as OrphanMaintenanceRecord[],
    documents: documents as OrphanDocument[],
    settlementSourcedLoans: (loansRes.data ?? []) as SettlementSourcedLoan[],
  };
}

export function useOrphanSummary() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery<OrphanSummary>({
    queryKey: ['orphan-summary', userId],
    queryFn: () => fetchOrphanSummary(userId as string),
    enabled: !!userId,
  });
}

export function useDeleteOrphanTolls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('tolls').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      await invalidateFinancialData(queryClient, { entities: ['tolls'] });
    },
  });
}

export function useDeleteOrphanMaintenanceRecords() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('maintenance_records').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      await invalidateFinancialData(queryClient, { entities: ['maintenance_records'] });
    },
  });
}

export function useDeleteOrphanDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // Reuses the SAME cleanupOrphanedDocument() every other delete
      // flow in this app calls — it re-checks "still referenced" itself
      // one more time before removing anything, so this stays safe even
      // if something started referencing a document between the summary
      // fetch and this action.
      const outcomes = await Promise.allSettled(ids.map((id) => cleanupOrphanedDocument(id)));
      const failed = outcomes.filter((o) => o.status === 'rejected');
      if (failed.length > 0) throw new Error(`${failed.length} of ${ids.length} document(s) could not be removed.`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      await invalidateFinancialData(queryClient, { entities: ['documents'] });
    },
  });
}
