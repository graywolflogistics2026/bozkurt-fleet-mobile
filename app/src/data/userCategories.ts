import { useMemo } from 'react';
import { createEntityHooks } from '@/src/data/entityHooks';
import { mergeCategoryOptions } from '@/src/import/category';
import type { UserCategory, UserCategoryInsert, UserCategoryUpdate } from '@/src/types/db';

// docs/PENDING_SQL.md §21 (custom categories, owner decision 2026-07-10,
// PRODUCT DECISION) — entirely optional/additive, same entityHooks factory
// pattern as trucks.ts/drivers.ts. UI (add/edit/"+ New category" inline
// creation across deduction edit, manual add, import preview) lands
// PROMPTS.md Session 9a; this file is the data-layer plumbing for it. The
// pure merge/default logic (mergeCategoryOptions, applyScheduleCDefault)
// lives in app/src/import/category.ts — re-exported below — so it stays
// unit-testable without pulling in React/Supabase (same split as
// app/src/tax/driverPayroll.ts vs app/src/data/driverPayments.ts).
export { DEFAULT_SCHEDULE_C_BUCKET, applyScheduleCDefault, mergeCategoryOptions } from '@/src/import/category';

const hooks = createEntityHooks<UserCategory, UserCategoryInsert, UserCategoryUpdate>('user_categories');
export const useUserCategories = hooks.useEntityList;
export const useInsertUserCategory = hooks.useEntityInsert;
export const useUpdateUserCategory = hooks.useEntityUpdate;
export const useDeleteUserCategory = hooks.useEntityDelete;

export function useCategoryOptions(kind: 'income' | 'expense') {
  const { data } = useUserCategories({ active: true, kind });
  const customCategories = useMemo(() => data ?? [], [data]);
  return useMemo(() => mergeCategoryOptions(kind, customCategories), [kind, customCategories]);
}
