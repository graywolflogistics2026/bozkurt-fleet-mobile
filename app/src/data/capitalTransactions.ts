import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntityHooks } from '@/src/data/entityHooks';
import { supabase } from '@/src/lib/supabase';
import { manualTransactionBalanceDelta } from '@/src/stats/capitalAccount';
import type { CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate } from '@/src/types/db';

const hooks = createEntityHooks<CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate>(
  'capital_transactions'
);
export const useCapitalTransactions = hooks.useEntityList;
export const useInsertCapitalTransaction = hooks.useEntityInsert;
export const useUpdateCapitalTransaction = hooks.useEntityUpdate;
export const useDeleteCapitalTransaction = hooks.useEntityDelete;

// FULL PARITY pass (owner decision 2026-08-05, spec item E.3 "equity
// moves cash, not tax") — inserting/deleting a MANUAL draw or
// contribution also applies the exact signed delta to
// profiles.business_balance via the SAME atomic RPC settlement imports
// use (apply_business_balance_delta, §37/§38), and records exactly what
// was applied in business_balance_applied (§41) so a later delete can
// reverse the EXACT applied amount — never re-derive it from the row's
// current amount/tx_type, which protects against drift if a future
// screen ever allows editing amount/tx_type after the fact. Never used
// for a LINKED contribution (see manualTransactionBalanceDelta's own
// comment) — those stay on the plain useInsertCapitalTransaction/
// useDeleteCapitalTransaction hooks above, driven by
// deductionMutations.ts's applyContributionSyncPlan().
export function useRecordManualCapitalTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: CapitalTransactionInsert) => {
      const delta = manualTransactionBalanceDelta(values.tx_type, Number(values.amount ?? 0));
      const { data, error } = await supabase
        .from('capital_transactions')
        .insert({ ...values, business_balance_applied: delta })
        .select()
        .single();
      if (error) throw error;
      if (delta !== 0) {
        const { error: balErr } = await supabase.rpc('apply_business_balance_delta', {
          p_user_id: values.user_id,
          p_delta: delta,
        });
        if (balErr) throw balErr;
      }
      return data as CapitalTransaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDeleteManualCapitalTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Pick<CapitalTransaction, 'id' | 'user_id' | 'business_balance_applied'>) => {
      const { error } = await supabase.from('capital_transactions').delete().eq('id', tx.id);
      if (error) throw error;
      const reversal = -Number(tx.business_balance_applied ?? 0);
      if (reversal !== 0) {
        const { error: balErr } = await supabase.rpc('apply_business_balance_delta', {
          p_user_id: tx.user_id,
          p_delta: reversal,
        });
        if (balErr) throw balErr;
      }
      return tx.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
