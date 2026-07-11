import { createEntityHooks } from '@/src/data/entityHooks';
import type { Reimbursement, ReimbursementInsert, ReimbursementUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Reimbursement, ReimbursementInsert, ReimbursementUpdate>('reimbursements');
export const useReimbursements = hooks.useEntityList;
export const useInsertReimbursement = hooks.useEntityInsert;
export const useUpdateReimbursement = hooks.useEntityUpdate;
export const useDeleteReimbursement = hooks.useEntityDelete;
