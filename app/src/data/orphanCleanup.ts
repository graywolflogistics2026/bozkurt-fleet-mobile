import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { findDuplicateLoanGroups, type LoanDuplicateGroup, type LoanMatchCandidate } from '@/src/import/loanMatch';
import { EQUIPMENT_TYPE_CATEGORIES } from '@/src/import/category';
import { buildLinkedEquipmentInsert, findMissingEquipmentBackfill, type BackfillDeductionRow, type ExistingEquipmentRow } from '@/src/import/equipmentLink';

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

// LOAN DEDUPE CLEANUP (owner decision, device report: "give me a tool
// listing the duplicate warranty loans so I can merge/remove them") —
// this is a SEPARATE, DELETABLE section from settlementSourcedLoans
// above (which stays informational-only, never offered for deletion): a
// row grouped here is one the FIXED loan-upsert matching (loanMatch.ts's
// findMatchingLoan(), applied going forward in aiImportSave.ts) would now
// treat as "the same obligation" and update in place — these groups are
// the historical backlog created by the OLD exact-string-match bug,
// before that fix existed.
export type DuplicateLoanRow = LoanMatchCandidate & { created_at: string; source: string | null };

export type OrphanSummary = {
  tolls: OrphanToll[];
  maintenanceRecords: OrphanMaintenanceRecord[];
  documents: OrphanDocument[];
  settlementSourcedLoans: SettlementSourcedLoan[];
  duplicateLoanGroups: LoanDuplicateGroup<DuplicateLoanRow>[];
  missingEquipment: BackfillDeductionRow[];
};

async function fetchOrphanSummary(userId: string): Promise<OrphanSummary> {
  const [tollsRes, maintRes, documentsRes, settlementsRes, dedRes, loansRes, allLoansRes, equipDedRes, equipRes] = await Promise.all([
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
    // LOAN DEDUPE CLEANUP — every loan on the account, regardless of
    // source, grouped by the SAME normalized-name key the fixed upsert
    // now matches on (loanMatch.ts's findDuplicateLoanGroups()), so this
    // list is exactly "what the fix would now treat as one loan."
    supabase.from('loans').select('id, name, lender, balance, original_amount, created_at, source').eq('user_id', userId),
    // EQUIPMENT AUTO-POPULATE BACKFILL (owner decision, SIMPLIFICATION
    // PASS, item 7.4) — every existing deduction already sitting in a
    // durable-goods category, scanned against every existing Equipment
    // row (both by link and by fuzzy match) in findMissingEquipmentBackfill().
    supabase.from('deductions').select('id, category, description, amount, ded_date, store').eq('user_id', userId).in('category', EQUIPMENT_TYPE_CATEGORIES as string[]),
    supabase.from('equipment').select('linked_deduction_id, name, purchase_price, purchase_date').eq('user_id', userId),
  ]);
  if (tollsRes.error) throw tollsRes.error;
  if (maintRes.error) throw maintRes.error;
  if (documentsRes.error) throw documentsRes.error;
  if (settlementsRes.error) throw settlementsRes.error;
  if (dedRes.error) throw dedRes.error;
  if (loansRes.error) throw loansRes.error;
  if (allLoansRes.error) throw allLoansRes.error;
  if (equipDedRes.error) throw equipDedRes.error;
  if (equipRes.error) throw equipRes.error;

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

  const duplicateLoanGroups = findDuplicateLoanGroups((allLoansRes.data ?? []) as DuplicateLoanRow[])
    // Recommend a "keep" candidate per group: the row with the most
    // complete balance data (a real, nonzero balance beats a null one —
    // it has actually been updated by a real recap line), tie-broken by
    // earliest created_at (the original). Sorted so the UI can render the
    // recommended row first without any extra logic of its own.
    .map((group) => ({
      ...group,
      loans: [...group.loans].sort((a, b) => {
        const aHasBalance = a.balance != null && a.balance !== 0;
        const bHasBalance = b.balance != null && b.balance !== 0;
        if (aHasBalance !== bHasBalance) return aHasBalance ? -1 : 1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }),
    }));

  const missingEquipment = findMissingEquipmentBackfill(
    (equipDedRes.data ?? []) as BackfillDeductionRow[],
    (equipRes.data ?? []) as ExistingEquipmentRow[]
  );

  return {
    tolls: (tollsRes.data ?? []) as OrphanToll[],
    maintenanceRecords: (maintRes.data ?? []) as OrphanMaintenanceRecord[],
    documents: documents as OrphanDocument[],
    settlementSourcedLoans: (loansRes.data ?? []) as SettlementSourcedLoan[],
    duplicateLoanGroups,
    missingEquipment,
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

// LOAN DEDUPE CLEANUP — plain delete by id list, same shape as
// useDeleteOrphanTolls/useDeleteOrphanMaintenanceRecords above. Unlike
// those two, this is deleting REAL LOAN ROWS the user has explicitly
// reviewed and chosen to remove (a duplicate created by the old exact-
// match bug, per the recommended "keep" row shown above each group) —
// still a real, standing-obligation table, so this action requires the
// same explicit multi-select + confirm flow every other bulk delete in
// this screen already uses; nothing here is auto-selected or auto-merged
// on the user's behalf.
export function useDeleteDuplicateLoans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('loans').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      await invalidateFinancialData(queryClient, { entities: ['loans'] });
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

// EQUIPMENT AUTO-POPULATE BACKFILL (owner decision, SIMPLIFICATION PASS,
// item 7.4) — creates the missing linked Equipment row for each selected
// deduction. Reuses buildLinkedEquipmentInsert() — the SAME function
// aiImportSave.ts's own live import path calls — so a backfilled row is
// built exactly the same way a freshly-imported one would be, never a
// second, drifting construction. Never re-checks for a duplicate itself
// (the summary's own findMissingEquipmentBackfill() already excluded
// anything already covered at the moment it was fetched) — a genuinely
// new collision in the narrow window between fetch and this action is the
// same accepted, rare race every other bulk action on this screen already
// tolerates (documents' own cleanupOrphanedDocument() is the one
// exception that re-checks, because ITS failure mode — deleting a still-
// referenced file — is destructive; this one's failure mode is at worst a
// harmless duplicate Equipment row the user can delete like any other).
export function useRunEquipmentBackfill() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: BackfillDeductionRow[]) => {
      if (!userId || rows.length === 0) return;
      const inserts = rows.map((row) => buildLinkedEquipmentInsert(row, row.id, userId)).filter((row): row is NonNullable<typeof row> => !!row);
      if (inserts.length === 0) return;
      const { error } = await supabase.from('equipment').insert(inserts);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      await invalidateFinancialData(queryClient, { entities: ['equipment'] });
    },
  });
}
