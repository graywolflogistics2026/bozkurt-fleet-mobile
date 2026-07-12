import { createEntityHooks } from '@/src/data/entityHooks';
import type { MiscIncome, MiscIncomeInsert, MiscIncomeUpdate } from '@/src/types/db';

const hooks = createEntityHooks<MiscIncome, MiscIncomeInsert, MiscIncomeUpdate>('misc_income');
export const useMiscIncome = hooks.useEntityList;
export const useInsertMiscIncome = hooks.useEntityInsert;
export const useUpdateMiscIncome = hooks.useEntityUpdate;
export const useDeleteMiscIncome = hooks.useEntityDelete;
