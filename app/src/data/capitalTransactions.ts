import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntityHooks } from '@/src/data/entityHooks';
import { supabase } from '@/src/lib/supabase';
import { calcReimbursementStatus, type ReimbursementStatus } from '@/src/stats/capitalAccount';
import type { CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate } from '@/src/types/db';

const hooks = createEntityHooks<CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate>('capital_transactions');
export const useCapitalTransactions = hooks.useEntityList;
export const useInsertCapitalTransaction = hooks.useEntityInsert;
export const useUpdateCapitalTransaction = hooks.useEntityUpdate;
export const useDeleteCapitalTransaction = hooks.useEntityDelete;

// BALANCE LEDGER ATOMICITY FIX (docs/PENDING_SQL.md §60, FULL SYSTEM
// AUDIT owner decision 2026-08-26) — every mutation below used to write
// its row (with a `business_balance_applied` tracking value already
// filled in) and THEN call `apply_business_balance_delta` as a SEPARATE
// step. If the RPC step failed after the row write had already
// succeeded — a real possibility, nothing here was ever wrapped in a
// transaction — the row was left permanently claiming a delta that was
// never actually applied, with no rollback. Worst case was delete: the
// row (the only record of what needed reversing) was removed BEFORE the
// reversal ran.
//
// Fixed by moving the row write and the balance-delta application into
// ONE atomic RPC per operation (record_manual_capital_transaction /
// update_manual_capital_transaction / delete_manual_capital_transaction,
// §60) — either both happen or neither does. Each RPC also computes its
// own delta from a FRESH, row-locked read of the row's current state
// server-side, never from a value this file might otherwise have
// captured earlier and trusted stale.
//
// `app/src/stats/capitalAccount.ts`'s `manualTransactionBalanceDelta()`/
// `computeManualTransactionBalanceAdjustment()` are no longer called from
// here (the RPCs compute the identical formula themselves, in SQL) — left
// in place, unused, as a P2 dead-code cleanup flagged separately rather
// than folded into this fix, to keep this change scoped to exactly the
// atomicity bug.

// FULL PARITY pass (owner decision 2026-08-05, spec item E.3 "equity
// moves cash, not tax") — inserting a MANUAL draw or contribution applies
// the signed delta to profiles.business_balance atomically via
// record_manual_capital_transaction() (+amount for a contribution, cash
// deposited into business checking; -amount for a draw, cash withdrawn).
// Never used for a LINKED contribution (auto-synced from a personally-paid
// deduction — no real cash moved into checking for that event, only
// equity was built by paying a business expense out of pocket; crediting
// business_balance there would fabricate a deposit that never happened) —
// those stay on the plain useInsertCapitalTransaction/
// useDeleteCapitalTransaction hooks above, driven by
// deductionMutations.ts's applyContributionSyncPlan().
export function useRecordManualCapitalTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: CapitalTransactionInsert) => {
      const { data, error } = await supabase.rpc('record_manual_capital_transaction', {
        p_user_id: values.user_id,
        p_tx_type: values.tx_type,
        p_amount: Number(values.amount ?? 0),
        p_tx_date: values.tx_date,
        p_note: values.note ?? null,
        p_linked_deduction_id: values.linked_deduction_id ?? null,
      });
      if (error) throw error;
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
// record_manual_capital_transaction() RPC as every other real cash
// movement on this screen — a reimbursement moves cash OUT of the
// business, same direction as a plain draw.
export function useReimburseMyself() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { userId: string; deductionId: string; amount: number; note: string | null }) => {
      const { data, error } = await supabase.rpc('record_manual_capital_transaction', {
        p_user_id: values.userId,
        p_tx_type: 'draw',
        p_amount: values.amount,
        p_tx_date: new Date().toISOString().slice(0, 10),
        p_note: values.note,
        p_linked_deduction_id: values.deductionId,
      });
      if (error) throw error;
      return data as CapitalTransaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 3
// "every row editable"). Edits a MANUAL (non-linked) draw/contribution's
// date/amount/note; update_manual_capital_transaction() (§60) reads the
// row's CURRENT business_balance_applied fresh, under a row lock, and
// adjusts the balance by the difference ONLY — never by re-crediting the
// full new amount (which would double-count whatever was already
// applied), and never trusting a client-supplied "previous" value that
// could be stale. Never used for a LINKED contribution (those have no
// business_balance_applied delta to adjust at all — see
// manualTransactionBalanceDelta's own header comment); a linked row's
// date/note edit goes through the plain useUpdateCapitalTransaction hook
// instead, since it never touches business_balance.
export function useUpdateManualCapitalTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      userId: string;
      txType: 'contribution' | 'draw';
      amount: number;
      txDate: string;
      note: string | null;
    }) => {
      const { data, error } = await supabase.rpc('update_manual_capital_transaction', {
        p_id: params.id,
        p_user_id: params.userId,
        p_tx_type: params.txType,
        p_amount: params.amount,
        p_tx_date: params.txDate,
        p_note: params.note,
      });
      if (error) throw error;
      return data as CapitalTransaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// delete_manual_capital_transaction() (§60) reads the row and reverses
// the balance FIRST, and only deletes the row once that reversal has
// already committed within the SAME transaction — if the reversal fails
// for any reason, the whole transaction rolls back and the row is NEVER
// deleted. This is the fix for "delete is worst" — the previous
// implementation deleted the row BEFORE attempting the reversal, so a
// failed reversal left no record of what needed correcting.
export function useDeleteManualCapitalTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Pick<CapitalTransaction, 'id' | 'user_id'>) => {
      const { error } = await supabase.rpc('delete_manual_capital_transaction', {
        p_id: tx.id,
        p_user_id: tx.user_id,
      });
      if (error) throw error;
      return tx.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
