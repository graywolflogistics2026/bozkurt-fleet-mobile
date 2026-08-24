import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntityHooks } from '@/src/data/entityHooks';
import { supabase } from '@/src/lib/supabase';
import { normalizeKeyword } from '@/src/import/categoryLearning';
import { normalizeCarrierKey } from '@/src/import/carrierCodes';
import type { CategoryLearningRule, CategoryLearningRuleInsert, CategoryLearningRuleUpdate } from '@/src/types/db';

// CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision) — a
// deduction row itself has no carrier column (only its parent settlement
// does, docs/PENDING_SQL.md §52), so scoping a manual correction to the
// right carrier means looking the settlement up. Returns null for a
// standalone/out-of-pocket deduction (no settlement_id) or when the
// lookup fails for any reason — never blocks the correction itself from
// being learned as a universal rule instead.
export async function fetchCarrierForDeduction(deduction: { settlement_id?: string | null }): Promise<string | null> {
  if (!deduction.settlement_id) return null;
  try {
    const { data, error } = await supabase.from('settlements').select('carrier').eq('id', deduction.settlement_id).maybeSingle();
    if (error || !data) return null;
    return normalizeCarrierKey(data.carrier as string | null);
  } catch {
    return null;
  }
}

const hooks = createEntityHooks<CategoryLearningRule, CategoryLearningRuleInsert, CategoryLearningRuleUpdate>(
  'category_learning_rules'
);
export const useCategoryLearningRules = hooks.useEntityList;
export const useInsertCategoryLearningRule = hooks.useEntityInsert;
export const useUpdateCategoryLearningRule = hooks.useEntityUpdate;
export const useDeleteCategoryLearningRule = hooks.useEntityDelete;

// CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
// follow-up item G) — called whenever a user manually changes a
// deduction's category to something different from what it was.
// Upserts on (user_id, keyword, carrier): a repeated correction for the
// same vendor UNDER THE SAME CARRIER SCOPE overwrites the category (the
// user's most recent choice always wins) and bumps hit_count, never
// creates a duplicate row. CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass
// (owner decision) — `carrier` is optional; omitted/null means a
// UNIVERSAL rule (the only kind that existed before this pass, and still
// the only kind a non-settlement correction can produce, since there's
// no carrier to know outside a settlement-import context). A universal
// correction and a carrier-scoped correction for the SAME vendor text
// are deliberately separate rows — a user's global "always call this X"
// preference must never be silently narrowed to one carrier just because
// they also made one carrier-specific correction.
export function useLearnCategoryCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      description,
      category,
      carrier,
    }: {
      userId: string;
      description: string | null;
      category: string;
      carrier?: string | null;
    }) => {
      const keyword = normalizeKeyword(description);
      if (!keyword) return null; // nothing distinctive to learn from
      const carrierValue = carrier ?? null;

      let findQuery = supabase.from('category_learning_rules').select('id, hit_count').eq('user_id', userId).eq('keyword', keyword);
      findQuery = carrierValue ? findQuery.eq('carrier', carrierValue) : findQuery.is('carrier', null);
      const { data: existing, error: findError } = await findQuery.maybeSingle();
      if (findError) throw findError;

      if (existing) {
        const { error: updateError } = await supabase
          .from('category_learning_rules')
          .update({ category, hit_count: Number(existing.hit_count ?? 1) + 1 })
          .eq('id', existing.id as string);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('category_learning_rules')
          .insert({ user_id: userId, keyword, category, hit_count: 1, carrier: carrierValue });
        if (insertError) throw insertError;
      }
      return keyword;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category_learning_rules'] });
    },
  });
}
