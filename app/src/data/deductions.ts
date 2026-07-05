import { createEntityHooks } from '@/src/data/entityHooks';
import type { Deduction, DeductionInsert, DeductionUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Deduction, DeductionInsert, DeductionUpdate>('deductions');
export const useDeductions = hooks.useEntityList;
export const useInsertDeduction = hooks.useEntityInsert;
export const useUpdateDeduction = hooks.useEntityUpdate;
export const useDeleteDeduction = hooks.useEntityDelete;
