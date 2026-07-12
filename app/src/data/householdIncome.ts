import { createEntityHooks } from '@/src/data/entityHooks';
import type { HouseholdIncome, HouseholdIncomeInsert, HouseholdIncomeUpdate } from '@/src/types/db';

const hooks = createEntityHooks<HouseholdIncome, HouseholdIncomeInsert, HouseholdIncomeUpdate>('household_income');
export const useHouseholdIncome = hooks.useEntityList;
export const useInsertHouseholdIncome = hooks.useEntityInsert;
export const useUpdateHouseholdIncome = hooks.useEntityUpdate;
export const useDeleteHouseholdIncome = hooks.useEntityDelete;
