import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { buildMarkDeductionReviewedUpdate, buildMarkDocumentReviewedUpdate } from '@/src/import/needsReview';

// NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
// testing round). These are the ONLY two mutations anywhere in the app
// that write `reviewed_at` — every screen's "Mark reviewed" control routes
// through one of these two, so the canonical override
// (src/import/needsReview.ts) is always set the same way. Callers are
// still responsible for calling invalidateFinancialData(queryClient)
// afterward (the established convention every other screen mutation in
// this app already follows — see deductions.tsx), since react-query's
// default `refetchType: 'active'` on a bare table-key invalidation isn't
// guaranteed to reach an inactive screen (e.g. Home's AI Coach card when
// the mark-reviewed action happened from the Deductions screen).
export function useMarkDeductionReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deduction: { id: string; description: string | null }) => {
      const values = buildMarkDeductionReviewedUpdate(deduction.description);
      const { data, error } = await supabase.from('deductions').update(values).eq('id', deduction.id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deductions'] }),
  });
}

export function useMarkDocumentReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const values = buildMarkDocumentReviewedUpdate();
      const { data, error } = await supabase.from('documents').update(values).eq('id', documentId).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

// Bulk "Mark all reviewed" (item 1's filtered-list action) — applies the
// SAME per-row update as useMarkDeductionReviewed above, one row at a
// time (mirrors aiImportSave.ts's own resilient-batch convention: a
// single bad row must never block the rest), then invalidates once.
export function useMarkAllDeductionsReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deductions: { id: string; description: string | null }[]) => {
      const now = new Date().toISOString();
      const results = await Promise.allSettled(
        deductions.map((d) => {
          const values = buildMarkDeductionReviewedUpdate(d.description, now);
          return supabase.from('deductions').update(values).eq('id', d.id).then(({ error }) => {
            if (error) throw error;
          });
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: deductions.length, failed };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deductions'] }),
  });
}
