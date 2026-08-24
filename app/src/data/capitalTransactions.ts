import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntityHooks } from '@/src/data/entityHooks';
import { supabase } from '@/src/lib/supabase';
import { manualTransactionBalanceDelta, calcReimbursementStatus, type ReimbursementStatus } from '@/src/stats/capitalAccount';
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

// PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 2 item 1) — reads whatever's linked to a specific
// deduction (its own contribution row + every reimbursement draw against
// it) and computes the real, current status via
// calcReimbursementStatus() — used both to render "reimbursed $X of $Y" /
// "not yet reimbursed" on a deduction row and to clamp the Reimburse
// Myself action to the actual outstanding amount.
export async function fetchReimbursementStatus(userId: string, deductionId: string): Promise<ReimbursementStatus | null> {
  const { data, error } = await supabase
    .from('capital_transactions')
    .select('tx_type, amount')
    .eq('user_id', userId)
    .eq('linked_deduction_id', deductionId);
  if (error) throw error;
  const rows = (data ?? []) as { tx_type: 'contribution' | 'draw'; amount: number | null }[];
  const contribution = rows.find((r) => r.tx_type === 'contribution');
  if (!contribution) return null; // not a personally-paid row (no linked contribution to reimburse)
  const draws = rows.filter((r) => r.tx_type === 'draw');
  return calcReimbursementStatus(Number(contribution.amount ?? 0), draws);
}

// "Reimburse Myself" — creates a DRAW linked to the SAME deduction its
// contribution came from (reusing linked_deduction_id, see
// src/stats/capitalAccount.ts's own header comment on this being
// dual-purpose by design, no new column). Same atomic
// apply_business_balance_delta RPC pattern as every other real cash
// movement on this screen — a reimbursement moves cash OUT of the
// business, same direction as a plain draw.
export function useReimburseMyself() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { userId: string; deductionId: string; amount: number; note: string | null }) => {
      const delta = manualTransactionBalanceDelta('draw', values.amount);
      const { data, error } = await supabase
        .from('capital_transactions')
        .insert({
          user_id: values.userId,
          tx_type: 'draw',
          amount: values.amount,
          tx_date: new Date().toISOString().slice(0, 10),
          note: values.note,
          linked_deduction_id: values.deductionId,
          business_balance_applied: delta,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: balErr } = await supabase.rpc('apply_business_balance_delta', {
        p_user_id: values.userId,
        p_delta: delta,
      });
      if (balErr) throw balErr;
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
