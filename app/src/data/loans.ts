import { createEntityHooks } from '@/src/data/entityHooks';
import type { LoanRow, LoanInsert, LoanUpdate } from '@/src/types/db';

const hooks = createEntityHooks<LoanRow, LoanInsert, LoanUpdate>('loans');
export const useLoanRows = hooks.useEntityList;
export const useInsertLoanRow = hooks.useEntityInsert;
export const useUpdateLoanRow = hooks.useEntityUpdate;
export const useDeleteLoanRow = hooks.useEntityDelete;
