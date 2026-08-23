import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntityHooks } from '@/src/data/entityHooks';
import { supabase } from '@/src/lib/supabase';
import { normalizeKeyword } from '@/src/import/categoryLearning';
import type { CategoryLearningRule, CategoryLearningRuleInsert, CategoryLearningRuleUpdate } from '@/src/types/db';

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
// Upserts on (user_id, keyword): a repeated correction for the same
// vendor overwrites the category (the user's most recent choice always
// wins) and bumps hit_count, never creates a duplicate row.
export function useLearnCategoryCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, description, category }: { userId: string; description: string | null; category: string }) => {
      const keyword = normalizeKeyword(description);
      if (!keyword) return null; // nothing distinctive to learn from
      const { data: existing, error: findError } = await supabase
        .from('category_learning_rules')
        .select('id, hit_count')
        .eq('user_id', userId)
        .eq('keyword', keyword)
        .maybeSingle();
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
          .insert({ user_id: userId, keyword, category, hit_count: 1 });
        if (insertError) throw insertError;
      }
      return keyword;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category_learning_rules'] });
    },
  });
}
